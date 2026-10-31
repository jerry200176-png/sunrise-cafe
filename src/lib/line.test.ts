import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: () => ({ from: mocks.from }) }));

import { sendLineFlexMessage } from "./line";

const TONGDE = "11111111-2222-4333-8444-555555555555";
const chain = (data: unknown) => {
  const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data, error: null }) };
  return c;
};
const authOf = () => ((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LINE_CUSTOMER_ACCESS_TOKEN", "daan-token");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("customer push picks the store's own LINE account", () => {
  it("without branch accounts configured: default account, no database lookup", async () => {
    await sendLineFlexMessage("U1", "alt", { type: "bubble" } as never, { reservationId: "res-1" });
    expect(authOf().Authorization).toBe("Bearer daan-token");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("a reservation at 同德店 is sent from 同德店's account", async () => {
    vi.stubEnv("LINE_BRANCH_CUSTOMER_BOTS", JSON.stringify([{ branch_id: TONGDE, name: "同德店", secret: "s", token: "td-token" }]));
    mocks.from.mockReturnValue(chain({ room: { branch_id: TONGDE } }));
    await sendLineFlexMessage("U1", "alt", { type: "bubble" } as never, { reservationId: "res-1", retryKey: "k1" });
    expect(mocks.from).toHaveBeenCalledWith("reservations");
    expect(authOf()).toMatchObject({ Authorization: "Bearer td-token", "X-Line-Retry-Key": "k1" });
  });

  it("a waitlist notice resolves the store from the room", async () => {
    vi.stubEnv("LINE_BRANCH_CUSTOMER_BOTS", JSON.stringify([{ branch_id: TONGDE, name: "同德店", secret: "s", token: "td-token" }]));
    mocks.from.mockReturnValue(chain({ branch_id: TONGDE }));
    await sendLineFlexMessage("U1", "alt", { type: "bubble" } as never, { roomId: "room-1" });
    expect(mocks.from).toHaveBeenCalledWith("rooms");
    expect(authOf().Authorization).toBe("Bearer td-token");
  });

  it("大安店 reservations (no own account) keep the default account", async () => {
    vi.stubEnv("LINE_BRANCH_CUSTOMER_BOTS", JSON.stringify([{ branch_id: TONGDE, name: "同德店", secret: "s", token: "td-token" }]));
    mocks.from.mockReturnValue(chain({ room: { branch_id: "99999999-2222-4333-8444-555555555555" } }));
    await sendLineFlexMessage("U1", "alt", { type: "bubble" } as never, { reservationId: "res-2" });
    expect(authOf().Authorization).toBe("Bearer daan-token");
  });
});


describe("customer provider acceptance", () => {
  it.each(["stalled", "interrupted", "sensitive"] as const)("classifies a 429 without reading the %s response body", async (mode) => {
    const body = vi.fn(() => mode === "stalled" ? new Promise<string>(() => {}) : mode === "interrupted" ? Promise.reject(new Error("stream interrupted")) : Promise.resolve("姓名 王小明 電話 0912345678 群組 C-secret"));
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 429, headers: new Headers(), body: null, text: body } as unknown as Response);
    const error = await sendLineFlexMessage("U1", "alt", { type: "bubble" } as never).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ outcome: "rejected", message: "LINE push 失敗：429" });
    expect(String(error)).not.toMatch(/王小明|0912345678|C-secret/);
    expect(body).not.toHaveBeenCalled();
  }, 1000);
  it.each([[429, "rejected"], [409, "unknown"], [503, "unknown"]] as const)("classifies HTTP %s without guessing acceptance", async (status, outcome) => {
    vi.mocked(fetch).mockResolvedValue(new Response("provider error", { status }));
    await expect(sendLineFlexMessage("U1", "alt", { type: "bubble" } as never)).rejects.toMatchObject({ outcome });
  });
  it("rejects a bare 409 instead of marking it accepted", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("conflict", { status: 409 }));
    await expect(sendLineFlexMessage("U1", "alt", { type: "bubble" } as never, { retryKey: "key" })).rejects.toThrow("409");
  });
  it("accepts a duplicate only with LINE's accepted request id", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 409, headers: { "x-line-accepted-request-id": "accepted" } }));
    await expect(sendLineFlexMessage("U1", "alt", { type: "bubble" } as never, { retryKey: "key" })).resolves.toBeUndefined();
  });
  it("never falls back to the group token when customer credentials are missing", async () => {
    vi.stubEnv("LINE_CUSTOMER_ACCESS_TOKEN", "");
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "staff-token");
    await expect(sendLineFlexMessage("U1", "alt", { type: "bubble" } as never)).rejects.toThrow("LINE_CUSTOMER_ACCESS_TOKEN");
    expect(fetch).not.toHaveBeenCalled();
  });
});
