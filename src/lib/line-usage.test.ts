import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessLineQuota,
  decideLineUsage,
  fetchCustomerLineQuotaAudits,
  estimateMonthlyMessageConsumption,
  fetchLineQuotaAudit,
  fetchLineQuotaSnapshot,
  readLineUsageBudget,
} from "./line-usage";

describe("LINE usage budget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never suppresses critical or actionable notifications", () => {
    const snapshot = { used: 999, limit: 1000 };
    const budget = { enabled: true, monthlyBudget: 100, expectedDaily: 1, surgeMultiplier: 1 };

    expect(decideLineUsage("critical", snapshot, budget).allowed).toBe(true);
    expect(decideLineUsage("actionable", snapshot, budget).allowed).toBe(true);
  });

  it("suppresses informational messages at the configured monthly budget", () => {
    const decision = decideLineUsage(
      "informational",
      { used: 100, limit: 500 },
      { enabled: true, monthlyBudget: 100, expectedDaily: null, surgeMultiplier: 3 }
    );

    expect(decision).toMatchObject({ allowed: false, reason: "monthly_budget", projectedUsage: 101 });
  });

  it("detects an informational usage surge from the expected daily pace", () => {
    const decision = decideLineUsage(
      "informational",
      { used: 61, limit: null },
      { enabled: true, monthlyBudget: null, expectedDaily: 10, surgeMultiplier: 3 },
      1,
      new Date("2026-09-02T01:00:00Z")
    );

    expect(decision).toMatchObject({ allowed: false, reason: "surge" });
  });

  it("reads a quota snapshot without exposing the access token", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ totalUsage: 17 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ type: "limited", value: 100 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ready", success: 4 }) });
    vi.stubGlobal("fetch", fetchSpy);

    const snapshot = await fetchLineQuotaSnapshot(
      "secret-token",
      new Date("2026-09-09T00:00:00Z")
    );

    expect(snapshot).toMatchObject({ used: 17, limit: 100, limitType: "limited", dailyPush: 4 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer secret-token" },
    });
  });

  it("reports official quota endpoints independently when one is unavailable", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ type: "limited", value: 100 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ready", success: 4 }) });
    vi.stubGlobal("fetch", fetchSpy);

    const audit = await fetchLineQuotaAudit("secret-token", new Date("2026-09-09T00:00:00Z"));

    expect(audit.status).toBe("partial");
    expect(audit.endpoints.consumption.available).toBe(false);
    expect(audit.endpoints.quota.available).toBe(true);
    expect(audit.endpoints.dailyPush.available).toBe(true);
    expect(audit.snapshot).toMatchObject({ used: null, limit: 100, dailyPush: 4 });
  });

  it("keeps the local quota guard disabled until explicitly enabled", () => {
    const budget = readLineUsageBudget({
      LINE_MONTHLY_MESSAGE_BUDGET: "100",
      LINE_EXPECTED_DAILY_MESSAGES: "1",
    } as unknown as NodeJS.ProcessEnv);
    expect(budget.enabled).toBe(false);
    expect(
      decideLineUsage("informational", { used: 1000, limit: 1000 }, budget).reason
    ).toBe("local_guard_disabled");
  });

  it("estimates baseline and aggregated monthly consumption", () => {
    const baseline = estimateMonthlyMessageConsumption({
      days: 30,
      groupDigestRuns: 30,
      groupDigestMessagesPerRun: 3,
      guestDigestRecipients: 90,
      guestDigestMessagesPerRecipient: 1,
      depositReminderRecipients: 30,
      depositReminderMessagesPerRecipient: 2,
      lifecycleGroupMessages: 30,
      lifecycleGuestMessages: 30,
      informationalHeartbeats: 30,
    });
    const aggregated = baseline - 30;

    expect(baseline).toBe(330);
    expect(aggregated).toBe(300);
  });

  it("parses optional budget settings", () => {
    expect(
      readLineUsageBudget({
        LINE_USAGE_GUARD_ENABLED: "true",
        LINE_MONTHLY_MESSAGE_BUDGET: "900",
        LINE_EXPECTED_DAILY_MESSAGES: "30",
        LINE_USAGE_SURGE_MULTIPLIER: "2",
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual({ enabled: true, monthlyBudget: 900, expectedDaily: 30, surgeMultiplier: 2 });
  });
});

describe("customer LINE account quota", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const BRANCH = "11111111-1111-4111-8111-111111111111";

  function stubQuotaByToken(byToken: Record<string, { used: number; limit: number | null }>) {
    const calls: { url: string; token: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { headers: { Authorization: string } }) => {
        const token = init.headers.Authorization.replace("Bearer ", "");
        calls.push({ url, token });
        const q = byToken[token];
        if (!q) return { ok: false, status: 401, json: async () => ({}) };
        if (url.endsWith("/quota/consumption")) return { ok: true, json: async () => ({ totalUsage: q.used }) };
        if (url.endsWith("/quota"))
          return { ok: true, json: async () => (q.limit == null ? { type: "none" } : { type: "limited", value: q.limit }) };
        return { ok: true, json: async () => ({ status: "ready", success: 2 }) };
      })
    );
    return calls;
  }

  it("assesses warn and critical thresholds and ignores unlimited plans", () => {
    expect(assessLineQuota({ used: 100, limit: 200, limitType: "limited" })).toEqual({ level: "ok", percentUsed: 50 });
    expect(assessLineQuota({ used: 160, limit: 200, limitType: "limited" }).level).toBe("warn");
    expect(assessLineQuota({ used: 191, limit: 200, limitType: "limited" }).level).toBe("critical");
    expect(assessLineQuota({ used: 999, limit: null, limitType: "none" }).level).toBe("unknown");
    expect(assessLineQuota({ used: null, limit: 200, limitType: "limited" }).level).toBe("unknown");
  });

  it("queries the default customer account and each branch bot with its own token", async () => {
    const calls = stubQuotaByToken({
      "cust-token": { used: 190, limit: 200 },
      "branch-token": { used: 10, limit: 200 },
    });
    const audits = await fetchCustomerLineQuotaAudits({
      LINE_CUSTOMER_ACCESS_TOKEN: "cust-token",
      LINE_CHANNEL_ACCESS_TOKEN: "staff-token",
      LINE_BRANCH_CUSTOMER_BOTS: JSON.stringify([
        { branch_id: BRANCH, name: "同德店", secret: "s", token: "branch-token" },
      ]),
    } as unknown as NodeJS.ProcessEnv);

    expect(audits.map((a) => [a.label, a.kind, a.level])).toEqual([
      ["customer-default", "default", "critical"],
      ["同德店", "branch", "ok"],
    ]);
    expect(audits[1].branchId).toBe(BRANCH);
    expect(calls.some((c) => c.url.endsWith("/v2/bot/message/quota/consumption") && c.token === "cust-token")).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/v2/bot/message/quota") && c.token === "branch-token")).toBe(true);
    // The staff bot is not this function's concern, and no token leaks into the result.
    expect(calls.some((c) => c.token === "staff-token")).toBe(false);
    expect(JSON.stringify(audits)).not.toMatch(/cust-token|branch-token|staff-token/);
  });

  it("does not fall back to the staff token when the customer token is missing", async () => {
    const original = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "staff-token";
    const calls = stubQuotaByToken({ "staff-token": { used: 1, limit: 200 } });
    try {
      const audits = await fetchCustomerLineQuotaAudits({} as NodeJS.ProcessEnv);
      expect(audits).toHaveLength(1);
      expect(audits[0].audit.status).toBe("unavailable");
      expect(audits[0].audit.endpoints.quota.error).toMatch(/customer token not configured/);
      expect(calls).toHaveLength(0);
    } finally {
      if (original === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
      else process.env.LINE_CHANNEL_ACCESS_TOKEN = original;
    }
  });

  it("queries accounts sharing a token once and reports unreadable quota as unavailable", async () => {
    const calls = stubQuotaByToken({});
    const audits = await fetchCustomerLineQuotaAudits({
      LINE_CUSTOMER_ACCESS_TOKEN: "same",
      LINE_BRANCH_CUSTOMER_BOTS: JSON.stringify([{ branch_id: BRANCH, name: "B", secret: "s", token: "same" }]),
    } as unknown as NodeJS.ProcessEnv);
    expect(calls).toHaveLength(3);
    expect(audits.every((a) => a.audit.status === "unavailable" && a.level === "unknown")).toBe(true);
  });
});
