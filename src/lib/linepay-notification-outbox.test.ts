import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendLineFlex } = vi.hoisted(() => ({ sendLineFlex: vi.fn() }));
vi.mock("@/lib/line-notify", () => ({
  sendLineFlexToBranchGroup: sendLineFlex,
  buildPaymentConfirmedFlex: vi.fn(() => ({ type: "bubble" })),
}));

import { deliverLinePayNotification } from "./linepay-notification-outbox";

function client() {
  const current = {
    id: "outbox-1", status: "pending", attempt_count: 0,
    payload: { customer_name: "Test", booking_code: "ABC123", start_time: "2026-08-20T10:00:00+08:00", end_time: "2026-08-20T12:00:00+08:00", amount: 300 },
  };
  const claimed = { ...current, status: "retrying", attempt_count: 1 };
  const updateChain = {
    eq: vi.fn(() => updateChain),
    in: vi.fn(() => updateChain),
    select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: claimed, error: null })) })),
    then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
  };
  const from = vi.fn((table: string) => {
    if (table === "line_pay_notification_attempts") return { insert: vi.fn(async () => ({ error: null })) };
    return {
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: current, error: null })) })) })),
      update: vi.fn(() => updateChain),
    };
  });
  return { from };
}

beforeEach(() => { vi.clearAllMocks(); sendLineFlex.mockResolvedValue(undefined); });

describe("LINE Pay notification outbox", () => {
  it("marks a sent attempt after the group push succeeds", async () => {
    const result = await deliverLinePayNotification("outbox-1", client() as never);
    expect(result).toBe("sent");
    expect(sendLineFlex).toHaveBeenCalledTimes(1);
  });

  it("records a failed attempt for retry when the group push fails", async () => {
    sendLineFlex.mockRejectedValue(new Error("LINE unavailable"));
    const result = await deliverLinePayNotification("outbox-1", client() as never);
    expect(result).toBe("failed");
  });
});
