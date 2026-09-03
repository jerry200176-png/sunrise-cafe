import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimLineGuestNotificationDelivery,
  deliverLineGuestNotification,
  markLineGuestNotificationDelivery,
} from "./line-guest-delivery";
import {
  buildGuestAttendanceConfirmedFlex,
  buildGuestBookingCancelledFlex,
  buildGuestBookingRescheduledFlex,
} from "./line-cards";

function mockClient(input: {
  claim?: { delivery_id?: string } | null;
  claimError?: { code?: string; message?: string } | null;
  updateError?: { code?: string; message?: string } | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: input.claim ?? null, error: input.claimError ?? null });
  const rpc = vi.fn(() => ({ maybeSingle }));
  const updateEq = vi.fn().mockResolvedValue({ error: input.updateError ?? null });
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn(() => ({ update }));
  return { rpc, from, maybeSingle, update, updateEq };
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
});

describe("line guest notification delivery ledger", () => {
  it("returns the database claim id", async () => {
    const client = mockClient({ claim: { delivery_id: "delivery-1" } });
    const result = await claimLineGuestNotificationDelivery({
      notificationType: "deposit_request",
      reservationId: "reservation-1",
      recipientId: "U1",
      client: client as never,
    });

    expect(result).toEqual({ available: true, id: "delivery-1" });
    expect(client.rpc).toHaveBeenCalledWith("claim_line_guest_notification_delivery", {
      p_notification_type: "deposit_request",
      p_reservation_id: "reservation-1",
      p_recipient_id: "U1",
      p_event_key: "default",
    });
  });

  it("treats a missing migration as compatibility mode outside production", async () => {
    const client = mockClient({
      claimError: { code: "PGRST202", message: "claim_line_guest_notification_delivery not found" },
    });
    const result = await claimLineGuestNotificationDelivery({
      notificationType: "deposit_request",
      reservationId: "reservation-1",
      recipientId: "U1",
      client: client as never,
    });

    expect(result).toEqual({ available: false, id: null });
  });

  it("updates sent state with a timestamp", async () => {
    const client = mockClient({});
    await markLineGuestNotificationDelivery("delivery-1", { status: "sent" }, client as never);

    expect(client.from).toHaveBeenCalledWith("line_guest_notification_deliveries");
    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent", sent_at: expect.any(String), last_error: null })
    );
    expect(client.updateEq).toHaveBeenCalledWith("id", "delivery-1");
  });

  it("sends a claimed lifecycle event once and marks it sent", async () => {
    const client = mockClient({ claim: { delivery_id: "delivery-1" } });
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await deliverLineGuestNotification({
      notificationType: "booking_rescheduled",
      reservationId: "reservation-1",
      recipientId: "U1",
      send,
      client: client as never,
    });

    expect(result).toBe("sent");
    expect(send).toHaveBeenCalledOnce();
    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent", sent_at: expect.any(String) })
    );
  });

  it("does not send when another process already owns the lifecycle event", async () => {
    const client = mockClient({ claim: null });
    const send = vi.fn();
    const result = await deliverLineGuestNotification({
      notificationType: "booking_cancelled",
      reservationId: "reservation-1",
      recipientId: "U1",
      send,
      client: client as never,
    });

    expect(result).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
  });

  it("records a failed LINE push so staff can retry explicitly", async () => {
    const client = mockClient({ claim: { delivery_id: "delivery-1" } });
    const send = vi.fn().mockRejectedValue(new Error("LINE unavailable"));
    const result = await deliverLineGuestNotification({
      notificationType: "attendance_confirmed",
      reservationId: "reservation-1",
      recipientId: "U1",
      send,
      client: client as never,
    });

    expect(result).toBe("error");
    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", last_error: "LINE unavailable" })
    );
  });

  it("provides valid guest lifecycle card builders", () => {
    const common = {
      customerName: "測試客人",
      branchName: "昇昇咖啡",
      bookingCode: "ABC123",
      startTime: "2026-07-05T10:00:00+08:00",
      endTime: "2026-07-05T12:00:00+08:00",
    };
    expect(buildGuestBookingCancelledFlex(common).type).toBe("bubble");
    expect(
      buildGuestBookingRescheduledFlex({
        ...common,
        oldStart: common.startTime,
        oldEnd: common.endTime,
        newStart: "2026-07-06T14:00:00+08:00",
        newEnd: "2026-07-06T16:00:00+08:00",
      }).type
    ).toBe("bubble");
    expect(buildGuestAttendanceConfirmedFlex(common).type).toBe("bubble");
  });
});
