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
});

describe("checkLineAccountsAndAlert", () => {
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
