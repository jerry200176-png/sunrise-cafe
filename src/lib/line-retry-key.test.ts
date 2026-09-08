import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendLineFlex } from "./line-notify";
import { sendLineFlexMessage } from "./line";
import type { LineFlexContainer } from "./line-flex";

describe("LINE Messaging API X-Line-Retry-Key & 409 reconciliation", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "mock-channel-token";
    process.env.LINE_GROUP_ID = "mock-group-id";
    process.env.LINE_CUSTOMER_ACCESS_TOKEN = "mock-customer-token";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  const dummyFlex: LineFlexContainer = {
    type: "bubble",
    body: { type: "box", layout: "vertical", contents: [] },
  };

  it("attaches X-Line-Retry-Key header to staff group push request", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const testRetryUuid = "00000000-0000-4000-8000-000000000001";
    await sendLineFlex("測試通知", dummyFlex, { retryKey: testRetryUuid });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(init.headers["X-Line-Retry-Key"]).toBe(testRetryUuid);
    expect(init.headers["Authorization"]).toBe("Bearer mock-channel-token");
  });

  it("reconciles LINE HTTP 409 Conflict as accepted success for staff group push", async () => {
    const headers = new Headers();
    headers.set("x-line-accepted-request-id", "req-accepted-999");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers,
      text: async () => JSON.stringify({ message: "The retry key is already accepted" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const testRetryUuid = "00000000-0000-4000-8000-000000000001";
    // Must NOT throw error! 409 is reconciled as accepted.
    await expect(
      sendLineFlex("測試通知", dummyFlex, { retryKey: testRetryUuid })
    ).resolves.toBeUndefined();
  });

  it("throws error on LINE HTTP 500 so client can retry", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: async () => "Internal Server Error",
    });
    vi.stubGlobal("fetch", fetchSpy);

    const testRetryUuid = "00000000-0000-4000-8000-000000000001";
    await expect(
      sendLineFlex("測試通知", dummyFlex, { retryKey: testRetryUuid })
    ).rejects.toThrow(/LINE API 錯誤 \(500\)/);
  });

  it("attaches X-Line-Retry-Key header to guest bot push request", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const testRetryUuid = "00000000-0000-4000-8000-000000000002";
    await sendLineFlexMessage("U1234567890", "訂金已確認", dummyFlex, {
      retryKey: testRetryUuid,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(init.headers["X-Line-Retry-Key"]).toBe(testRetryUuid);
    expect(init.headers["Authorization"]).toBe("Bearer mock-customer-token");
  });

  it("reconciles LINE HTTP 409 Conflict as accepted success for guest bot push", async () => {
    const headers = new Headers();
    headers.set("x-line-accepted-request-id", "req-accepted-guest-888");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers,
      text: async () => JSON.stringify({ message: "The retry key is already accepted" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const testRetryUuid = "00000000-0000-4000-8000-000000000002";
    // Must NOT throw error! 409 is reconciled as accepted.
    await expect(
      sendLineFlexMessage("U1234567890", "訂金已確認", dummyFlex, {
        retryKey: testRetryUuid,
      })
    ).resolves.toBeUndefined();
  });
});
