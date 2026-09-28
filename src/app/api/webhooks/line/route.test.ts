import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ from: vi.fn(), replyText: vi.fn(), replyFlex: vi.fn(), logOps: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/line", () => ({ replyLineTextMessage: mocks.replyText, replyLineFlexMessage: mocks.replyFlex }));
vi.mock("@/lib/ops-log", () => ({ logOps: mocks.logOps }));

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
  vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "default-token");
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

  it("the default bot joining a group also reports the ID with the default token", async () => {
    await POST(webhook([{ type: "join", replyToken: "rt-2", source: { type: "group", groupId: "C-new" } }], "default-secret"));
    const [, init] = lineCalls()[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer default-token" });
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
