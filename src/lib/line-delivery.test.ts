import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimLineReminderDelivery,
  claimFailedLineReminderDelivery,
  markLineReminderDelivery,
  readLineReminderDeliveryState,
  hasOtherGroupDelivery,
  isReminderNoLongerRequired,
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
  status?: string | null;
  statusError?: { message?: string } | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: input.claim ?? null,
    error: input.claimError ?? null,
  });
  const rpc = vi.fn(() => ({ maybeSingle }));
  const updateEq = vi.fn().mockResolvedValue({ error: input.updateError ?? null });
  const update = vi.fn(() => ({ eq: updateEq }));
  const statusMaybeSingle = vi.fn().mockResolvedValue({ data: input.status ? { status: input.status } : null, error: input.statusError ?? null });
  const statusEq: ReturnType<typeof vi.fn> = vi.fn(() => ({ eq: statusEq, maybeSingle: statusMaybeSingle }));
  const statusSelect = vi.fn(() => ({ eq: statusEq }));
  const from = vi.fn(() => ({ update, select: statusSelect }));
  return { rpc, from, maybeSingle, update, updateEq, statusEq, statusSelect };
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  vi.mocked(supabaseAdmin).mockReset();
});

describe("line reminder delivery ledger", () => {
  it("queries for other group history without returning recipient identifiers", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "delivery" }, error: null });
    const limit = vi.fn(() => ({ maybeSingle }));
    const neq: ReturnType<typeof vi.fn> = vi.fn(() => ({ limit, neq }));
    const eq: ReturnType<typeof vi.fn> = vi.fn(() => ({ eq, neq }));
    const select = vi.fn(() => ({ eq }));
    vi.mocked(supabaseAdmin).mockReturnValue({ from: vi.fn(() => ({ select })) } as never);
    await expect(hasOtherGroupDelivery({ reminderType: "d1_group", reminderDate: "2026-09-05", reservationId: "r1", recipientType: "group", recipientId: "legacy-group" })).resolves.toBe(true);
    expect(select).toHaveBeenCalledWith("id");
    expect(neq).toHaveBeenCalledWith("recipient_id", "legacy-group");
  });

  it("excludes both the legacy guard and the current branch from historical branch checks", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const limit = vi.fn(() => ({ maybeSingle }));
    const neq: ReturnType<typeof vi.fn> = vi.fn(() => ({ limit, neq }));
    const eq: ReturnType<typeof vi.fn> = vi.fn(() => ({ eq, neq }));
    vi.mocked(supabaseAdmin).mockReturnValue({ from: vi.fn(() => ({ select: () => ({ eq }) })) } as never);
    await expect(hasOtherGroupDelivery({ reminderType: "d1_group", reminderDate: "2026-09-05", reservationId: "r1", recipientType: "group", recipientId: "G-new" })).resolves.toBe(false);
    expect(neq).toHaveBeenCalledWith("recipient_id", "legacy-group");
    expect(neq).toHaveBeenCalledWith("recipient_id", "G-new");
  });
  it.each([
    [{ status: "cancelled", is_notified: false, d1_guest_reminder_sent_at: null, line_user_id: "U-old" }, "d1_group", true],
    [{ status: "confirmed", is_notified: true, d1_guest_reminder_sent_at: null, line_user_id: null }, "d1_group", true],
    [{ status: "confirmed", is_notified: false, d1_guest_reminder_sent_at: "2026-01-01", line_user_id: "U-old" }, "d1_guest", true],
    [{ status: "confirmed", is_notified: false, d1_guest_reminder_sent_at: null, line_user_id: null }, "d1_guest", true],
    [{ status: "confirmed", is_notified: false, d1_guest_reminder_sent_at: null, line_user_id: "U-new" }, "d1_guest", false],
    [{ status: "confirmed", is_notified: false, d1_guest_reminder_sent_at: null, line_user_id: "U-old" }, "d1_group", false],
    [null, "d1_group", false],
  ] as const)("checks current eligibility safely after a missing claim: %s", async (row, reminderType, expected) => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(supabaseAdmin).mockReturnValue({ from } as never);
    await expect(isReminderNoLongerRequired({ reminderType, reminderDate: "2026-09-05", reservationId: "r1", recipientType: reminderType === "d1_group" ? "group" : "guest", recipientId: "U-old" })).resolves.toBe(expected);
    expect(from).toHaveBeenCalledWith("reservations");
    expect(eq).toHaveBeenCalledWith("id", "r1");
  });

  it("reclaims a failed delivery with a compare-and-swap", async () => {
    const readMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "delivery-1", attempt_count: 2 },
      error: null,
    });
    const readEqStatus = vi.fn(() => ({ maybeSingle: readMaybeSingle }));
    const readEqId = vi.fn(() => ({ eq: readEqStatus }));
    const readSelect = vi.fn(() => ({ eq: readEqId }));
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: { id: "delivery-1" }, error: null });
    const updateSelect = vi.fn(() => ({ maybeSingle: updateMaybeSingle }));
    const updateEqAttempt = vi.fn(() => ({ select: updateSelect }));
    const updateEqStatus = vi.fn(() => ({ eq: updateEqAttempt }));
    const updateEqId = vi.fn(() => ({ eq: updateEqStatus }));
    const update = vi.fn(() => ({ eq: updateEqId }));
    const from = vi.fn(() => ({ select: readSelect, update }));
    vi.mocked(supabaseAdmin).mockReturnValue({ from } as never);

    await expect(claimFailedLineReminderDelivery("delivery-1")).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sending", attempt_count: 3, last_error: null })
    );
    expect(updateEqId).toHaveBeenCalledWith("id", "delivery-1");
    expect(updateEqStatus).toHaveBeenCalledWith("status", "failed");
    expect(updateEqAttempt).toHaveBeenCalledWith("attempt_count", 2);
  });

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

  it.each(["sending", "sent", "failed"] as const)("reads the existing %s state without a write", async (status) => {
    const client = mockClient({ status });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);
    const result = await readLineReminderDeliveryState({ reminderType: "d1_guest", reminderDate: "2026-09-05", reservationId: "r1", recipientType: "guest", recipientId: "private-recipient" });
    expect(result).toBe(status);
    expect(client.statusSelect).toHaveBeenCalledWith("status");
    expect(client.statusEq.mock.calls).toEqual([
      ["reminder_type", "d1_guest"], ["reminder_date", "2026-09-05"], ["reservation_id", "r1"], ["recipient_type", "guest"], ["recipient_id", "private-recipient"],
    ]);
    expect(client.update).not.toHaveBeenCalled();
  });

  it("does not guess that an absent or unreadable ledger record was sent", async () => {
    const key = { reminderType: "d1_guest" as const, reminderDate: "2026-09-05", reservationId: "r1", recipientType: "guest" as const, recipientId: "private-recipient" };
    vi.mocked(supabaseAdmin).mockReturnValue(mockClient({}) as never);
    await expect(readLineReminderDeliveryState(key)).resolves.toBe("missing");
    vi.mocked(supabaseAdmin).mockReturnValue(mockClient({ statusError: { message: "sensitive-provider-detail" } }) as never);
    await expect(readLineReminderDeliveryState(key)).rejects.toThrow("無法確認提醒紀錄狀態");
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
