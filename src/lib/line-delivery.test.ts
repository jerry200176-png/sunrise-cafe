import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimLineReminderDelivery,
  markLineReminderDelivery,
  safeLineDeliveryError,
} from "./line-delivery";

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase-admin";

function mockClient(input: {
  claim?: { delivery_id?: string } | null;
  claimError?: { code?: string; message?: string } | null;
  updateError?: { code?: string; message?: string } | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: input.claim ?? null,
    error: input.claimError ?? null,
  });
  const rpc = vi.fn(() => ({ maybeSingle }));
  const updateEq = vi.fn().mockResolvedValue({ error: input.updateError ?? null });
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn(() => ({ update }));
  return { rpc, from, maybeSingle, update, updateEq };
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  vi.mocked(supabaseAdmin).mockReset();
});

describe("line reminder delivery ledger", () => {
  it("returns the database claim id", async () => {
    const client = mockClient({ claim: { delivery_id: "delivery-1" } });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);

    const result = await claimLineReminderDelivery({
      reminderType: "d1_group",
      reminderDate: "2026-09-05",
      reservationId: "reservation-1",
      recipientType: "group",
      recipientId: "G1",
    });

    expect(result).toEqual({ available: true, id: "delivery-1" });
    expect(client.rpc).toHaveBeenCalledWith("claim_line_reminder_delivery", {
      p_reminder_type: "d1_group",
      p_reminder_date: "2026-09-05",
      p_reservation_id: "reservation-1",
      p_recipient_type: "group",
      p_recipient_id: "G1",
    });
  });

  it("treats a missing migration as compatibility mode outside production", async () => {
    const client = mockClient({
      claimError: { code: "PGRST202", message: "claim_line_reminder_delivery not found" },
    });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);

    const result = await claimLineReminderDelivery({
      reminderType: "d1_guest",
      reminderDate: "2026-09-05",
      reservationId: "reservation-1",
      recipientType: "guest",
      recipientId: "U1",
    });

    expect(result).toEqual({ available: false, id: null });
  });

  it("fails closed in production when the ledger RPC is missing", async () => {
    process.env.VERCEL_ENV = "production";
    const client = mockClient({
      claimError: { code: "PGRST202", message: "Could not find the function" },
    });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);

    await expect(
      claimLineReminderDelivery({
        reminderType: "d1_group",
        reminderDate: "2026-09-05",
        reservationId: "reservation-1",
        recipientType: "group",
        recipientId: "G1",
      })
    ).rejects.toThrow(/LINE reminder delivery ledger unavailable in production/);
  });

  it("does not treat an already-claimed row as sendable", async () => {
    const client = mockClient({ claim: null });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);

    const result = await claimLineReminderDelivery({
      reminderType: "d1_group",
      reminderDate: "2026-09-05",
      reservationId: "reservation-1",
      recipientType: "group",
      recipientId: "G1",
    });

    expect(result).toEqual({ available: true, id: null });
  });

  it("marks a claimed delivery sent", async () => {
    const client = mockClient({});
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);

    await markLineReminderDelivery("delivery-1", { status: "sent" });

    expect(client.from).toHaveBeenCalledWith("line_reminder_deliveries");
    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent", sent_at: expect.any(String), last_error: null })
    );
    expect(client.updateEq).toHaveBeenCalledWith("id", "delivery-1");
  });

  it("redacts LINE user ids from error text", () => {
    expect(safeLineDeliveryError(new Error("fail U1234567890abcdef1234567890abcdef"))).toContain(
      "[redacted_line_user]"
    );
  });
});
