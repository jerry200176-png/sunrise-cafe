import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideLineUsage,
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
