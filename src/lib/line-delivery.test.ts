import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimLineReminderDelivery,
  claimFailedLineReminderDelivery,
  hasDepositReleaseHold,
  holdDepositRelease,
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

describe("deposit release hold (#437)", () => {
  /** Ledger fake: rows filtered by the reminder_type the code asks for. */
  function ledger(rows: { reminder_type: string; status: string }[], upsertError: { message: string } | null = null, persist = true) {
    const store = [...rows];
    const upsert = vi.fn(async (row: { reminder_type: string; status: string }) => {
      if (!upsertError && persist) store.push(row);
      return { error: upsertError };
    });
    const from = vi.fn(() => ({
      upsert,
      select: () => {
        const f: { types?: string[] } = {};
        const q = {
          eq: (col: string, v: string) => { if (col === "reminder_type") f.types = [v]; return q; },
          in: (_c: string, v: string[]) => { f.types = v; return q; },
          limit: async () => ({ data: store.filter((r) => !f.types || f.types.includes(r.reminder_type)).map(() => ({ id: "x" })), error: null }),
        };
        return q;
      },
    }));
    return { from, upsert };
  }

  it("a release-message delivery row (sending/failed/sent) is NOT a hold", async () => {
    for (const t of ["deposit_release_guest", "deposit_release_group"]) {
      for (const status of ["sending", "failed", "sent"]) {
        vi.mocked(supabaseAdmin).mockReturnValue(ledger([{ reminder_type: t, status }]) as never);
        await expect(hasDepositReleaseHold("r1")).resolves.toBe(false);
      }
    }
  });

  it("only the explicit restore hold counts", async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(ledger([{ reminder_type: "deposit_restore_hold", status: "sent" }]) as never);
    await expect(hasDepositReleaseHold("r1")).resolves.toBe(true);
  });

  it("holdDepositRelease upserts the restore hold on the Taipei start date (no status dependency) and verifies it", async () => {
    const c = ledger([]);
    vi.mocked(supabaseAdmin).mockReturnValue(c as never);
    await holdDepositRelease("r1", "2026-10-11T18:00:00Z");
    expect(c.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ reminder_type: "deposit_restore_hold", reminder_date: "2026-10-12", reservation_id: "r1", status: "sent" }),
      expect.objectContaining({ ignoreDuplicates: true })
    );
  });

  it("an empty/unpersisted write is never treated as success", async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(ledger([], null, false) as never);
    await expect(holdDepositRelease("r1", "2026-10-11T18:00:00Z")).rejects.toThrow(/not persisted/);
  });

  it("a write error propagates", async () => {
    vi.mocked(supabaseAdmin).mockReturnValue(ledger([], { message: "boom" }) as never);
    await expect(holdDepositRelease("r1", "2026-10-11T18:00:00Z")).rejects.toBeTruthy();
  });
});
