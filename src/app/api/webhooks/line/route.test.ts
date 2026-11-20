import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), replyText: vi.fn(), replyFlex: vi.fn(), replyMessages: vi.fn(), logOps: vi.fn(),
  groupSend: vi.fn(async () => {}), countPending: vi.fn(async () => 0),
  aiOn: false, ask: vi.fn(async () => ({ text: "平日每小時 NT$300。", outcome: "answer" })),
}));
vi.mock("@/lib/line-ai-assistant", () => ({ aiAssistantEnabled: () => mocks.aiOn, askAssistant: mocks.ask, buildStoreFacts: () => "", worthAnswering: (t: string) => (t.match(/\p{L}/gu) ?? []).length >= 2 }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/line", () => ({ replyLineTextMessage: mocks.replyText, replyLineFlexMessage: mocks.replyFlex, replyLineMessages: mocks.replyMessages }));
vi.mock("@/lib/ops-log", () => ({ logOps: mocks.logOps }));
vi.mock("@/lib/payment-events-admin", () => ({ countPendingPaymentEventsForReservation: mocks.countPending }));
vi.mock("@/lib/line-notify", () => ({ sendLineFlexToBranchGroup: mocks.groupSend, buildPaymentPendingReviewGroupFlex: () => ({}) }));
vi.mock("@/lib/branch-line-group", () => ({ branchLineGroupIdForReservation: async () => "C-tongde-staff" }));

import { POST } from "./route";

const TONGDE = { name: "同德店", secret: "tongde-secret", token: "tongde-token" };
const sign = (body: string, secret: string) => crypto.createHmac("sha256", secret).update(body).digest("base64");
function webhook(events: unknown[], secret: string) {
  const body = JSON.stringify({ events });
  return new NextRequest("http://localhost/api/webhooks/line", {
    method: "POST",
    headers: { "x-line-signature": sign(body, secret) },
    body,
  });
}
const lineCalls = () =>
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).startsWith("https://api.line.me"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LINE_CHANNEL_SECRET", "default-secret");
  vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "group-token");
  vi.stubEnv("LINE_CUSTOMER_ACCESS_TOKEN", "customer-token");
  vi.stubEnv("LINE_EXTRA_GROUP_BOTS", JSON.stringify([TONGDE]));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("LINE webhook with per-branch group bots", () => {
  it("rejects a body signed by no configured bot", async () => {
    const res = await POST(webhook([], "attacker-secret"));
    expect(res.status).toBe(403);
  });

  it("replies with the group ID from the branch bot that joined", async () => {
    const res = await POST(webhook([{ type: "join", replyToken: "rt-1", source: { type: "group", groupId: "C-tongde" } }], TONGDE.secret));
    expect(res.status).toBe(200);
    const [url, init] = lineCalls()[0];
    expect(String(url)).toBe("https://api.line.me/v2/bot/message/reply");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tongde-token" });
    expect(String((init as RequestInit).body)).toContain("C-tongde");
  });

  // LINE_CHANNEL_SECRET belongs to the default customer account (大安店), so its reply token
  // only works with LINE_CUSTOMER_ACCESS_TOKEN — not the staff group bot's token.
  it("the default customer account joining a group reports the ID with its own token", async () => {
    await POST(webhook([{ type: "join", replyToken: "rt-2", source: { type: "group", groupId: "C-new" } }], "default-secret"));
    const [, init] = lineCalls()[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer customer-token" });
  });

  it("never treats staff chat in a branch bot's group as a guest payment report", async () => {
    const res = await POST(
      webhook([{ type: "message", replyToken: "rt-3", source: { type: "group", groupId: "C-tongde", userId: "U-staff" }, message: { type: "text", text: "已匯款 末五碼 12345" } }], TONGDE.secret)
    );
    expect(res.status).toBe(200);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.replyText).not.toHaveBeenCalled();
    expect(mocks.replyFlex).not.toHaveBeenCalled();
    expect(lineCalls()).toHaveLength(0);
  });
});

describe("LINE webhook with a store's own customer account", () => {
  const STORE = { branch_id: "11111111-2222-4333-8444-555555555555", name: "同德店客人", secret: "store-secret", token: "store-token" };
  const reservation = { id: "res-td", booking_code: "TD0001", customer_name: "客人", start_time: "2026-10-06T06:00:00Z", end_time: "2026-10-06T08:00:00Z" };

  function db() {
    const calls: { table: string; eqs: [string, unknown][]; select?: string }[] = [];
    mocks.from.mockImplementation((table: string) => {
      const call = { table, eqs: [] as [string, unknown][], select: undefined as string | undefined };
      calls.push(call);
      const chain: Record<string, unknown> = {
        select: (cols: string) => { call.select = cols; return chain; },
        eq: (col: string, val: unknown) => { call.eqs.push([col, val]); return chain; },
        in: () => chain, order: () => chain, limit: () => chain,
        single: async () => ({ data: table === "reservations" ? reservation : null, error: null }),
        insert: async () => ({ error: null }),
      };
      return chain;
    });
    return calls;
  }

  beforeEach(() => vi.stubEnv("LINE_BRANCH_CUSTOMER_BOTS", JSON.stringify([STORE])));

  it("a payment message to 同德店's account matches only 同德店 bookings and replies from that account", async () => {
    const calls = db();
    const res = await POST(webhook([{ type: "message", replyToken: "rt-9", source: { type: "user", userId: "U-guest" }, message: { type: "text", text: "已匯款 末五碼 12345" } }], STORE.secret));
    expect(res.status).toBe(200);
    const lookup = calls.find((c) => c.table === "reservations")!;
    expect(lookup.select).toContain("rooms!inner(branch_id)");
    expect(lookup.eqs).toContainEqual(["room.branch_id", STORE.branch_id]);
    expect(lookup.eqs).toContainEqual(["line_user_id", "U-guest"]);
    expect(calls.some((c) => c.table === "payment_events")).toBe(true);
    expect(mocks.groupSend).toHaveBeenCalledWith(expect.stringContaining("付款待確認"), expect.anything(), "C-tongde-staff");
    expect(mocks.replyFlex).toHaveBeenCalledWith("rt-9", "付款已收到", expect.anything(), "store-token");
  });

  it("the default account keeps today's lookup across all stores and its own token", async () => {
    const calls = db();
    await POST(webhook([{ type: "message", replyToken: "rt-8", source: { type: "user", userId: "U-guest" }, message: { type: "text", text: "已匯款 末五碼 12345" } }], "default-secret"));
    const lookup = calls.find((c) => c.table === "reservations")!;
    expect(lookup.eqs.some(([col]) => col === "room.branch_id")).toBe(false);
    expect(mocks.replyFlex).toHaveBeenCalledWith("rt-8", "付款已收到", expect.anything(), undefined);
  });
});

describe("LINE webhook chat booking", () => {
  const STORE = { branch_id: "11111111-2222-4333-8444-555555555555", name: "同德店客人", secret: "store-secret", token: "store-token" };
  beforeEach(() => vi.stubEnv("LINE_BRANCH_CUSTOMER_BOTS", JSON.stringify([STORE])));

  it("a store account answers a button from its own channel", async () => {
    const res = await POST(webhook([{ type: "postback", replyToken: "rt-s", source: { type: "user", userId: "U-guest" }, postback: { data: "nonsense" } }], STORE.secret));
    expect(res.status).toBe(200);
    const [replyToken, messages, token] = mocks.replyMessages.mock.calls[0];
    expect(replyToken).toBe("rt-s");
    expect(token).toBe("store-token");
    expect(messages[0].quickReply.items.map((i: { action: { label: string } }) => i.action.label)).toEqual(["我要訂位", "我的訂位", "看菜單", "店家資訊"]);
  });

  it("does not greet new friends yet (waits for the rich menu rollout)", async () => {
    await POST(webhook([{ type: "follow", replyToken: "rt-f", source: { type: "user", userId: "U-new" } }], STORE.secret));
    expect(mocks.replyMessages).not.toHaveBeenCalled();
  });

  it("answers an unreadable button with the menu instead of touching bookings", async () => {
    await POST(webhook([{ type: "postback", replyToken: "rt-p", source: { type: "user", userId: "U-guest" }, postback: { data: "a=dur&r=nope" } }], "default-secret"));
    expect(mocks.replyMessages).toHaveBeenCalledWith("rt-p", [expect.objectContaining({ text: expect.stringContaining("過期") })], undefined);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("ignores postbacks from the staff group bot", async () => {
    await POST(webhook([{ type: "postback", replyToken: "rt-g", source: { type: "group", groupId: "C-tongde", userId: "U-staff" }, postback: { data: "a=book" } }], TONGDE.secret));
    expect(mocks.replyMessages).not.toHaveBeenCalled();
  });

  const typed = (text: string) => webhook([{ type: "message", replyToken: "rt-q", source: { type: "user", userId: "U-guest" }, message: { type: "text", text } }], "default-secret");

  it("answers the word 訂位 with the menu buttons, AI on or off", async () => {
    await POST(typed("訂位"));
    expect(mocks.replyMessages).toHaveBeenCalledWith("rt-q", [expect.objectContaining({ quickReply: expect.anything() })], undefined);
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("leaves typed questions alone while the AI assistant is off", async () => {
    mocks.aiOn = false;
    await POST(typed("平日多少錢"));
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(mocks.replyMessages).not.toHaveBeenCalled();
  });

  it("answers a typed question with the AI assistant plus the menu buttons, never payment reports", async () => {
    mocks.aiOn = true;
    await POST(typed("平日多少錢"));
    expect(mocks.replyMessages).toHaveBeenCalledWith("rt-q", [expect.objectContaining({ text: "平日每小時 NT$300。", quickReply: expect.anything() })], undefined);
    mocks.ask.mockClear();
    await POST(typed("已匯款 末五碼 12345"));
    expect(mocks.ask).not.toHaveBeenCalled();
    const q = { type: "message", replyToken: "rt-b", source: { type: "user", userId: "U-guest" }, message: { type: "text", text: "幾點開門" } };
    await POST(webhook([q, q, q], "default-secret"));
    expect(mocks.ask).toHaveBeenCalledTimes(1); // one AI answer per webhook batch
    mocks.ask.mockClear();
    await POST(typed("12345"));
    await POST(typed("?"));
    expect(mocks.ask).not.toHaveBeenCalled();
    mocks.aiOn = false;
  });
});
