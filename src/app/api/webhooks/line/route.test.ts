import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), replyText: vi.fn(), replyFlex: vi.fn(), logOps: vi.fn(),
  groupSend: vi.fn(async () => {}), countPending: vi.fn(async () => 0),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/line", () => ({ replyLineTextMessage: mocks.replyText, replyLineFlexMessage: mocks.replyFlex }));
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
