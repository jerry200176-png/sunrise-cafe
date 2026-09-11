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
    mockClaim.mockResolvedValue({ available: true, id: "00000000-0000-4000-8000-000000000001" });
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
    expect(mockSend).toHaveBeenCalledWith(
      "U1",
      "訂金繳費通知",
      expect.any(Object),
      { retryKey: "00000000-0000-4000-8000-000000000001" }
    );
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

  it("does not send a stale request when payment is approved while claiming", async () => {
    // The row was unpaid when read, but the database claim returns no id after
    // the payment transition. This is the atomic guard that prevents an old
    // payment request from racing the approved-payment notification.
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

  it("sends only once when concurrent automatic triggers claim the same reservation", async () => {
    mockClaim
      .mockResolvedValueOnce({ available: true, id: "delivery-1" })
      .mockResolvedValueOnce({ available: true, id: null });
    const reservation = {
      id: "r1", line_user_id: "U1", customer_name: "王", booking_code: "ABC123",
      start_time: "2026-08-01T10:00:00+08:00", end_time: "2026-08-01T12:00:00+08:00",
      total_price: 2000, status: "confirmed", is_deposit_paid: false,
      payment_request_sent_at: null, room: null,
    };

    const results = await Promise.all([
      sendDepositPaymentRequest("r1", { client: mockClient(reservation) as never }),
      sendDepositPaymentRequest("r1", { client: mockClient(reservation) as never }),
    ]);
    expect(results.map((result) => result.result).sort()).toEqual(["sent", "skipped_already_sent"]);
    expect(mockSend).toHaveBeenCalledOnce();
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

  it("reuses the same delivery retry key and payload after a timeout without affecting another reservation", async () => {
    mockClaim
      .mockResolvedValueOnce({ available: true, id: "delivery-r1-first" })
      .mockResolvedValueOnce({ available: true, id: "delivery-r1-first" })
      .mockResolvedValueOnce({ available: true, id: "delivery-r2" });
    mockSend.mockRejectedValueOnce(new Error("timeout")).mockResolvedValue(undefined);
    const r1 = {
      id: "r1", line_user_id: "U1", customer_name: "王", booking_code: "ABC123",
      start_time: "2026-08-01T10:00:00+08:00", end_time: "2026-08-01T12:00:00+08:00",
      total_price: 2000, status: "confirmed", is_deposit_paid: false,
      payment_request_sent_at: null, room: null,
    };
    const r2 = { ...r1, id: "r2", line_user_id: "U2", booking_code: "XYZ789" };

    expect((await sendDepositPaymentRequest("r1", { client: mockClient(r1) as never })).result).toBe("error");
    expect((await sendDepositPaymentRequest("r1", { client: mockClient(r1) as never })).result).toBe("sent");
    expect((await sendDepositPaymentRequest("r2", { client: mockClient(r2) as never })).result).toBe("sent");
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend.mock.calls[0]).toEqual(mockSend.mock.calls[1]);
    expect(mockSend.mock.calls[0]?.[3]).toEqual({ retryKey: "delivery-r1-first" });
    expect(mockClaim).toHaveBeenLastCalledWith(
      expect.objectContaining({ reservationId: "r2", recipientId: "U2" })
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
