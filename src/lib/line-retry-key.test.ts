import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendLineFlex, sendLineFlexBatch, sendLineMessage } from "./line-notify";
import { sendLineFlexMessage } from "./line";
import { stableLineRetryKey } from "./line-retry-key";
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

  it("derives the same valid retry key for the same logical event", () => {
    const first = stableLineRetryKey("booking-rescheduled-group", "res-1", "2026-09-10T10:00:00Z");
    const second = stableLineRetryKey("booking-rescheduled-group", "res-1", "2026-09-10T10:00:00Z");
    const different = stableLineRetryKey("booking-rescheduled-group", "res-1", "2026-09-10T11:00:00Z");

    expect(first).toBe(second);
    expect(first).not.toBe(different);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

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

  it("packs up to five staff Flex notifications into one push request", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const messages = Array.from({ length: 5 }, (_, index) => ({
      altText: `通知 ${index + 1}`,
      contents: dummyFlex,
    }));
    await sendLineFlexBatch(messages, { retryKey: "00000000-0000-4000-8000-000000000003" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string) as { messages: unknown[] };
    expect(body.messages).toHaveLength(5);
    expect(init.headers["X-Line-Retry-Key"]).toBe("00000000-0000-4000-8000-000000000003");
  });

  it("rejects a batch larger than LINE's push limit", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const messages = Array.from({ length: 6 }, (_, index) => ({
      altText: `通知 ${index + 1}`,
      contents: dummyFlex,
    }));

    await expect(sendLineFlexBatch(messages)).rejects.toThrow(/最多 5/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("suppresses informational group pushes at the configured budget", async () => {
    process.env.LINE_USAGE_GUARD_ENABLED = "true";
    process.env.LINE_MONTHLY_MESSAGE_BUDGET = "1";
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ totalUsage: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ type: "limited", value: 100 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ready", success: 0 }) });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendLineMessage("狀態未變", { priority: "informational" }))
      .rejects.toMatchObject({ name: "LineInformationalSuppressedError", reason: "monthly_budget" });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
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
