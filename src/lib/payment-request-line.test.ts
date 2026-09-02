import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendDepositPaymentRequest } from "./payment-request-line";

vi.mock("@/lib/line-guest-delivery", () => ({
  claimLineGuestNotificationDelivery: vi.fn(),
  markLineGuestNotificationDelivery: vi.fn(),
}));

vi.mock("@/lib/line", () => ({
  sendLineFlexMessage: vi.fn(),
  buildPaymentFlex: vi.fn(() => ({ type: "bubble" })),
}));

import { sendLineFlexMessage, buildPaymentFlex } from "@/lib/line";
import {
  claimLineGuestNotificationDelivery,
  markLineGuestNotificationDelivery,
} from "@/lib/line-guest-delivery";

const mockSend = vi.mocked(sendLineFlexMessage);
const mockBuild = vi.mocked(buildPaymentFlex);
const mockClaim = vi.mocked(claimLineGuestNotificationDelivery);
const mockMark = vi.mocked(markLineGuestNotificationDelivery);

function mockClient(reservation: Record<string, unknown> | null) {
  const updateEq = vi.fn(() => Promise.resolve({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const branchSingle = vi.fn(() =>
    Promise.resolve({
      data: { name: "大安", payment_info: "銀行 123", line_pay_url: null },
      error: null,
    })
  );

  return {
    from: vi.fn((table: string) => {
      if (table === "branches") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: branchSingle,
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({ data: reservation, error: reservation ? null : { message: "missing" } })
            ),
          })),
        })),
        update,
      };
    }),
    _update: update,
    _updateEq: updateEq,
  };
}

beforeEach(() => {
  mockSend.mockReset();
  mockBuild.mockClear();
  mockSend.mockResolvedValue(undefined);
  mockClaim.mockResolvedValue({ available: false, id: null });
  mockMark.mockResolvedValue(undefined);
});

describe("sendDepositPaymentRequest", () => {
  it("skips when payment_request_sent_at already set (no force)", async () => {
    const client = mockClient({
      id: "r1",
      line_user_id: "U1",
      customer_name: "王",
      booking_code: "ABC123",
      start_time: "2026-08-01T10:00:00+08:00",
      end_time: "2026-08-01T12:00:00+08:00",
      total_price: 2000,
      status: "confirmed",
      is_deposit_paid: false,
      payment_request_sent_at: "2026-07-01T00:00:00Z",
      room: {
        name: "A",
        price_weekday: 800,
        price_weekend: 1000,
        branch: { id: "b1", name: "大安" },
      },
    });

    const r = await sendDepositPaymentRequest("r1", {
      force: false,
      client: client as never,
    });
    expect(r.result).toBe("skipped_already_sent");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends and stamps when not yet sent", async () => {
    const client = mockClient({
      id: "r1",
      line_user_id: "U1",
      customer_name: "王",
      booking_code: "ABC123",
      start_time: "2026-08-01T10:00:00+08:00",
      end_time: "2026-08-01T12:00:00+08:00",
      total_price: 2000,
      status: "confirmed",
      is_deposit_paid: false,
      payment_request_sent_at: null,
      room: {
        name: "A",
        price_weekday: 800,
        price_weekend: 1000,
        branch: { id: "b1", name: "大安" },
      },
    });

    const r = await sendDepositPaymentRequest("r1", {
      force: false,
      client: client as never,
    });
    expect(r.result).toBe("sent");
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(client._update).toHaveBeenCalled();
  });

  it("skips when the durable delivery claim is already held", async () => {
    mockClaim.mockResolvedValue({ available: true, id: null });
    const client = mockClient({
      id: "r1",
      line_user_id: "U1",
      customer_name: "王",
      booking_code: "ABC123",
      start_time: "2026-08-01T10:00:00+08:00",
      end_time: "2026-08-01T12:00:00+08:00",
      total_price: 2000,
      status: "confirmed",
      is_deposit_paid: false,
      payment_request_sent_at: null,
      room: null,
    });

    const r = await sendDepositPaymentRequest("r1", { client: client as never });
    expect(r.result).toBe("skipped_already_sent");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("marks the claimed delivery after LINE succeeds", async () => {
    mockClaim.mockResolvedValue({ available: true, id: "delivery-1" });
    const client = mockClient({
      id: "r1",
      line_user_id: "U1",
      customer_name: "王",
      booking_code: "ABC123",
      start_time: "2026-08-01T10:00:00+08:00",
      end_time: "2026-08-01T12:00:00+08:00",
      total_price: 2000,
      status: "confirmed",
      is_deposit_paid: false,
      payment_request_sent_at: null,
      room: null,
    });

    const r = await sendDepositPaymentRequest("r1", { client: client as never });
    expect(r.result).toBe("sent");
    expect(mockMark).toHaveBeenCalledWith("delivery-1", { status: "sent" }, client);
  });

  it("marks the claimed delivery failed so a later automatic attempt can retry", async () => {
    mockClaim.mockResolvedValue({ available: true, id: "delivery-1" });
    mockSend.mockRejectedValue(new Error("LINE unavailable"));
    const client = mockClient({
      id: "r1",
      line_user_id: "U1",
      customer_name: "王",
      booking_code: "ABC123",
      start_time: "2026-08-01T10:00:00+08:00",
      end_time: "2026-08-01T12:00:00+08:00",
      total_price: 2000,
      status: "confirmed",
      is_deposit_paid: false,
      payment_request_sent_at: null,
      room: null,
    });

    const r = await sendDepositPaymentRequest("r1", { client: client as never });
    expect(r.result).toBe("error");
    expect(mockMark).toHaveBeenCalledWith(
      "delivery-1",
      { status: "failed", error: "LINE unavailable" },
      client
    );
  });

  it("force resend even when already stamped", async () => {
    const client = mockClient({
      id: "r1",
      line_user_id: "U1",
      customer_name: "王",
      booking_code: "ABC123",
      start_time: "2026-08-01T10:00:00+08:00",
      end_time: "2026-08-01T12:00:00+08:00",
      total_price: 2000,
      status: "confirmed",
      is_deposit_paid: false,
      payment_request_sent_at: "2026-07-01T00:00:00Z",
      room: {
        name: "A",
        price_weekday: 800,
        price_weekend: 1000,
        branch: { id: "b1", name: "大安" },
      },
    });

    const r = await sendDepositPaymentRequest("r1", {
      force: true,
      client: client as never,
    });
    expect(r.result).toBe("sent");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("skips when already paid", async () => {
    const client = mockClient({
      id: "r1",
      line_user_id: "U1",
      customer_name: "王",
      booking_code: "ABC123",
      start_time: "2026-08-01T10:00:00+08:00",
      end_time: "2026-08-01T12:00:00+08:00",
      total_price: 2000,
      status: "confirmed",
      is_deposit_paid: true,
      payment_request_sent_at: null,
      room: null,
    });

    const r = await sendDepositPaymentRequest("r1", {
      client: client as never,
    });
    expect(r.result).toBe("skipped_paid");
    expect(mockSend).not.toHaveBeenCalled();
  });
});
