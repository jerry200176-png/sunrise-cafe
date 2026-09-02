import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimLineGuestNotificationDelivery,
  markLineGuestNotificationDelivery,
} from "./line-guest-delivery";

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
});
