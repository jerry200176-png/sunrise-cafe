import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLineAccounts, checkLineAccountsAndAlert, formatCollisionAlert } from "./line-account-audit";

const BRANCH = "c7893aaa-121f-4750-9fab-c0173cb3d422";
const bots: Record<string, { userId: string; displayName: string; basicId: string; used: number; limit: number }> = {
  "tok-group": { userId: "U-group", displayName: "昇咖啡提醒小幫手", basicId: "@111aaaa", used: 180, limit: 200 },
  "tok-customer": { userId: "U-cust", displayName: "昇咖啡 大安店", basicId: "@222bbbb", used: 40, limit: 500 },
  "tok-branch": { userId: "U-branch", displayName: "昇咖啡 桃園同德店", basicId: "@333cccc", used: 3, limit: 200 },
};

function lineFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const token = String((init?.headers as Record<string, string>).Authorization).replace("Bearer ", "");
    const bot = bots[token];
    if (!bot) return new Response("{}", { status: 401 });
    const body = url.endsWith("/v2/bot/info") ? { userId: bot.userId, displayName: bot.displayName, basicId: bot.basicId }
      : url.endsWith("/quota/consumption") ? { totalUsage: bot.used }
      : url.endsWith("/message/quota") ? { type: "limited", value: bot.limit }
      : { status: "ready", success: 5 };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

beforeEach(() => { vi.stubGlobal("fetch", lineFetch()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const env = (over: Record<string, string | undefined>) => ({ ...over }) as unknown as NodeJS.ProcessEnv;

describe("auditLineAccounts", () => {
  it("uses only the existing read endpoints and sends no message", async () => {
    await auditLineAccounts(env({ LINE_CHANNEL_ACCESS_TOKEN: "tok-group", LINE_CUSTOMER_ACCESS_TOKEN: "tok-customer" }));
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls).toHaveLength(8);
    const paths = new Set(["/v2/bot/info", "/v2/bot/message/quota/consumption", "/v2/bot/message/quota", "/v2/bot/message/delivery/push"]);
    for (const [input, init] of calls) {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.line.me");
      expect(paths.has(url.pathname)).toBe(true);
      expect(init?.method ?? "GET").toBe("GET");
    }
  });

  it("names the account and quota behind every token, without returning token values", async () => {
    const audit = await auditLineAccounts(env({
      LINE_CHANNEL_ACCESS_TOKEN: "tok-group",
      LINE_CUSTOMER_ACCESS_TOKEN: "tok-customer",
      LINE_BRANCH_CUSTOMER_BOTS: JSON.stringify([{ branch_id: BRANCH, name: "同德店", secret: "s", token: "tok-branch" }]),
    }), new Date("2026-10-21T00:00:00Z"));

    expect(audit.collisions).toEqual([]);
    expect(audit.identityComplete).toBe(true);
    // Quota grading comes from assessLineQuota (#483): 180/200 = 90% → warn.
    expect(audit.accounts[0].usage).toMatchObject({ level: "warn", percentUsed: 90 });
    expect(audit.accounts.map((a) => [a.role, a.source, a.displayName, a.basicId, a.usage?.monthUsed, a.usage?.monthLimit])).toEqual([
      ["group", "LINE_CHANNEL_ACCESS_TOKEN", "昇咖啡提醒小幫手", "@111aaaa", 180, 200],
      ["customer", "LINE_CUSTOMER_ACCESS_TOKEN", "昇咖啡 大安店", "@222bbbb", 40, 500],
      ["customer", "LINE_BRANCH_CUSTOMER_BOTS[同德店]", "昇咖啡 桃園同德店", "@333cccc", 3, 200],
    ]);
    const json = JSON.stringify(audit);
    expect(json).not.toContain("tok-");
    expect(json).not.toContain("U-");
  });

  it("flags a customer token that resolves to the staff group bot", async () => {
    const audit = await auditLineAccounts(env({
      LINE_CHANNEL_ACCESS_TOKEN: "tok-group",
      LINE_CUSTOMER_ACCESS_TOKEN: "tok-group",
      LINE_BRANCH_CUSTOMER_BOTS: JSON.stringify([{ branch_id: BRANCH, name: "同德店", secret: "s", token: "tok-group" }]),
    }));
    expect(audit.collisions.map((c) => [c.customerSource, c.groupSource, c.basicId])).toEqual([
      ["LINE_CUSTOMER_ACCESS_TOKEN", "LINE_CHANNEL_ACCESS_TOKEN", "@111aaaa"],
      ["LINE_BRANCH_CUSTOMER_BOTS[同德店]", "LINE_CHANNEL_ACCESS_TOKEN", "@111aaaa"],
    ]);
    expect(formatCollisionAlert(audit.collisions)).toContain("LINE_CUSTOMER_ACCESS_TOKEN 和 LINE_CHANNEL_ACCESS_TOKEN 是同一個帳號");
  });

  it("reports missing and invalid tokens instead of throwing", async () => {
    const audit = await auditLineAccounts(env({ LINE_CHANNEL_ACCESS_TOKEN: "revoked" }));
    expect(audit.accounts[0]).toMatchObject({ configured: true, error: expect.stringContaining("401"), displayName: null });
    expect(audit.accounts[1]).toMatchObject({ source: "LINE_CUSTOMER_ACCESS_TOKEN", configured: false, error: "未設定", usage: null });
    expect(audit.collisions).toEqual([]);
    expect(audit.identityComplete).toBe(false);
  });

  it("is not identity-complete when a customer token fails, so no collision is not proof of different accounts", async () => {
    const audit = await auditLineAccounts(env({ LINE_CHANNEL_ACCESS_TOKEN: "tok-group", LINE_CUSTOMER_ACCESS_TOKEN: "revoked" }));
    expect(audit.collisions).toEqual([]);
    expect(audit.identityComplete).toBe(false);
  });

  it("reports a provider outage as unknown without claiming the token is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider detail", { status: 503 })));
    const audit = await auditLineAccounts(env({ LINE_CUSTOMER_ACCESS_TOKEN: "customer-token" }));
    const customer = audit.accounts.find((account) => account.role === "customer");
    expect(customer?.error).toContain("503");
    expect(customer?.error).toContain("無法確認");
    expect(customer?.error).not.toContain("無效");
    expect(audit.identityComplete).toBe(false);
    expect(JSON.stringify(audit)).not.toMatch(/customer-token|provider detail/);
  });

  it("treats an aborted account identity request as unknown", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const original = lineFetch();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (!url.endsWith("/v2/bot/info")) return original(url, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }));
    const pending = auditLineAccounts(env({ LINE_CUSTOMER_ACCESS_TOKEN: "tok-customer" }));
    controller.abort();
    const audit = await pending;
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(audit.identityComplete).toBe(false);
    expect(audit.accounts.find((account) => account.role === "customer")?.error).toBe("連不上 LINE");
  });

  it.each([123, {}, [], null, "", " \t "])("does not infer a collision from an invalid identity (%s)", async (userId) => {
    const original = lineFetch();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
      url.endsWith("/v2/bot/info")
        ? Promise.resolve(new Response(JSON.stringify({ userId }), { status: 200 }))
        : original(url, init)));
    const settings = env({ LINE_CHANNEL_ACCESS_TOKEN: "tok-group", LINE_CUSTOMER_ACCESS_TOKEN: "tok-customer" });
    const audit = await auditLineAccounts(settings);
    expect(audit.identityComplete).toBe(false);
    expect(audit.collisions).toEqual([]);
    const send = vi.fn(async () => undefined);
    await expect(checkLineAccountsAndAlert(send, settings)).resolves.toEqual({ collisions: 0, alerted: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts nonempty identity strings without assuming a provider-specific format", async () => {
    const original = lineFetch();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
      url.endsWith("/v2/bot/info")
        ? Promise.resolve(new Response(JSON.stringify({ userId: "synthetic-id" }), { status: 200 }))
        : original(url, init)));
    const audit = await auditLineAccounts(env({ LINE_CHANNEL_ACCESS_TOKEN: "tok-group", LINE_CUSTOMER_ACCESS_TOKEN: "tok-customer" }));
    expect(audit.identityComplete).toBe(true);
    expect(audit.collisions).toHaveLength(1);
  });
});

describe("checkLineAccountsAndAlert", () => {
  it("alerts a confirmed collision after an unrelated identity request times out", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const original = lineFetch();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (!url.endsWith("/v2/bot/info") || authorization !== "Bearer tok-branch") return original(url, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const send = vi.fn(async (text: string) => { expect(text).toContain("LINE"); });
    const pending = checkLineAccountsAndAlert(send, env({
      LINE_CHANNEL_ACCESS_TOKEN: "tok-group",
      LINE_CUSTOMER_ACCESS_TOKEN: "tok-group",
      LINE_BRANCH_CUSTOMER_BOTS: JSON.stringify([{ branch_id: BRANCH, name: "測試店", secret: "s", token: "tok-branch" }]),
    }));
    expect(fetchMock.mock.calls.some(([url, init]) =>
      url.endsWith("/v2/bot/info") && (init?.headers as Record<string, string> | undefined)?.Authorization === "Bearer tok-branch")).toBe(true);
    expect(send).not.toHaveBeenCalled();
    controller.abort();
    await expect(pending).resolves.toEqual({ collisions: 1, alerted: true });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).not.toContain("tok-");
  });

  it("does not send a collision alert when account identity is unknown", async () => {
    const original = lineFetch();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
      url.endsWith("/v2/bot/info") ? Promise.resolve(new Response("unavailable", { status: 503 })) : original(url, init)));
    const send = vi.fn(async () => undefined);
    await expect(checkLineAccountsAndAlert(send, env({
      LINE_CHANNEL_ACCESS_TOKEN: "tok-group", LINE_CUSTOMER_ACCESS_TOKEN: "tok-customer",
    }))).resolves.toEqual({ collisions: 0, alerted: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("alerts the staff group only when a customer token is the group bot", async () => {
    const send = vi.fn(async () => undefined);
    expect(await checkLineAccountsAndAlert(send, env({ LINE_CHANNEL_ACCESS_TOKEN: "tok-group", LINE_CUSTOMER_ACCESS_TOKEN: "tok-customer" })))
      .toEqual({ collisions: 0, alerted: false });
    expect(send).not.toHaveBeenCalled();

    expect(await checkLineAccountsAndAlert(send, env({ LINE_CHANNEL_ACCESS_TOKEN: "tok-group", LINE_CUSTOMER_ACCESS_TOKEN: "tok-group" })))
      .toEqual({ collisions: 1, alerted: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(String((send.mock.calls[0] as unknown[])[0])).not.toContain("tok-");
  });

  it("never throws when the alert itself fails", async () => {
    const send = vi.fn(async () => { throw new Error("push failed"); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(checkLineAccountsAndAlert(send, env({ LINE_CHANNEL_ACCESS_TOKEN: "tok-group", LINE_CUSTOMER_ACCESS_TOKEN: "tok-group" })))
      .resolves.toEqual({ collisions: 0, alerted: false });
  });
});
