import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  fetchUnpaidDepositDueReservations: vi.fn(),
  fetchFailedDepositReleaseGroupDeliveries: vi.fn(async () => []),
  updateReservationAdmin: vi.fn(async () => {}),
  isAdminConfigured: vi.fn(() => true),
  supabaseAdmin: vi.fn(() => ({})),
}));
vi.mock("@/lib/line", () => ({ sendLineFlexMessage: vi.fn(async () => {}) }));
vi.mock("@/lib/line-notify", () => ({
  sendLineFlexBatch: vi.fn(async () => {}),
  sendLineFlexBatchToGroup: vi.fn(async () => {}),
  buildDepositReleasedGroupFlex: vi.fn(() => ({ type: "bubble" })),
}));
vi.mock("@/lib/branch-line-group", () => ({ branchLineGroupIdForReservation: vi.fn(async () => null) }));
vi.mock("@/lib/reservation-lifecycle", () => ({
  transitionReservation: vi.fn(async () => ({ ok: true, status: "cancelled" })),
}));
vi.mock("@/lib/line-delivery", () => ({
  claimLineReminderDelivery: vi.fn(async () => ({ available: true, id: "d1" })),
  claimFailedLineReminderDelivery: vi.fn(async () => false),
  markLineReminderDelivery: vi.fn(async () => {}),
  safeLineDeliveryError: vi.fn((e: unknown) => String(e)),
}));
vi.mock("@/lib/bootstrap-migrations", () => ({ runBootstrapMigrations: vi.fn(async () => {}) }));
vi.mock("@/lib/cron-request-auth", () => ({ authorizeCronGet: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/job-runs", () => ({
  runCronJob: vi.fn(async (_name: string, handler: () => Promise<Response>) => handler()),
}));
vi.mock("@/lib/payment-log", () => ({ logPayment: vi.fn(), logDepositStatusChange: vi.fn() }));

import { GET, POST } from "./route";
import { fetchUnpaidDepositDueReservations, fetchFailedDepositReleaseGroupDeliveries, updateReservationAdmin } from "@/lib/supabase-admin";
import { transitionReservation } from "@/lib/reservation-lifecycle";
import { sendLineFlexMessage } from "@/lib/line";
import { sendLineFlexBatch } from "@/lib/line-notify";
import type { NextRequest } from "next/server";
import { buildHalfHourSlots } from "@/lib/slot-grid";

const H = 3_600_000;
const NOW = new Date("2026-10-21T04:00:00Z");

function row(over: Record<string, unknown> = {}) {
  return {
    id: "r-past",
    booking_code: "ABC123",
    customer_name: "客",
    phone: "0900",
    // created 3 days ago, starts in 3h: deadline = max(created+48h, start-6h) = 3h ago → overdue
    created_at: new Date(NOW.getTime() - 72 * H).toISOString(),
    start_time: new Date(NOW.getTime() + 3 * H).toISOString(),
    end_time: new Date(NOW.getTime() + 5 * H).toISOString(),
    status: "pending",
    line_user_id: "U1",
    deposit_reminder_sent_at: null,
    deposit_urgent_reminder_sent_at: null,
    room: { id: "room", name: "A", branch: { name: "大安" } },
    ...over,
  };
}

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe("deposit-deadline cron retains unpaid bookings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    delete process.env.DEPOSIT_DEADLINE_AUTO_CANCEL;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.DEPOSIT_DEADLINE_AUTO_CANCEL;
  });

  it.each([undefined, "", "false", "0", "true", "TRUE", "1", "on", "yes"])(
    "does not cancel an overdue unpaid booking even with legacy flag %s (GET and POST)",
    async (value) => {
      if (value !== undefined) process.env.DEPOSIT_DEADLINE_AUTO_CANCEL = value;
      vi.mocked(fetchUnpaidDepositDueReservations).mockResolvedValue([row(), row({ id: "r-confirmed", status: "confirmed" })] as never);
      for (const res of [await POST(), await GET({} as NextRequest)]) {
        const body = await json(res);
        expect(body).toMatchObject({ ok: true, auto_cancel_enabled: false, released: 0, deadline_passed: 2 });
      }
      expect(transitionReservation).not.toHaveBeenCalled();
      expect(updateReservationAdmin).not.toHaveBeenCalled();
      expect(sendLineFlexMessage).not.toHaveBeenCalled();
      expect(sendLineFlexBatch).not.toHaveBeenCalled();
      // Only future bookings are read when nothing will be cancelled.
      expect(fetchUnpaidDepositDueReservations).toHaveBeenCalledWith({ startAfter: NOW.toISOString() });
    }
  );

  it("still sends the 24h reminder while the switch is off", async () => {
    // created now, starts in 20h → deadline is capped at start, inside the 24h window
    vi.mocked(fetchUnpaidDepositDueReservations).mockResolvedValue([
      row({ id: "r-soon", created_at: NOW.toISOString(), start_time: new Date(NOW.getTime() + 20 * H).toISOString() }),
    ] as never);
    const body = await json(await POST());
    expect(body).toMatchObject({ reminded: 1, released: 0, deadline_passed: 0 });
    expect(sendLineFlexMessage).toHaveBeenCalledTimes(1);
    expect(transitionReservation).not.toHaveBeenCalled();
  });

  it("still sends the urgent reminder when the first reminder was already sent", async () => {
    vi.mocked(fetchUnpaidDepositDueReservations).mockResolvedValue([
      row({ created_at: NOW.toISOString(), deposit_reminder_sent_at: new Date(NOW.getTime() - H).toISOString() }),
    ] as never);
    const body = await json(await POST());
    expect(body).toMatchObject({ urgentReminded: 1, released: 0 });
    expect(sendLineFlexMessage).toHaveBeenCalledTimes(1);
    expect(transitionReservation).not.toHaveBeenCalled();
  });

  it("retains overdue active bookings as blocked slots in the synthetic availability flow", async () => {
    const reservation = row({ status: "confirmed" });
    vi.mocked(fetchUnpaidDepositDueReservations).mockResolvedValue([reservation] as never);
    await POST();
    expect(transitionReservation).not.toHaveBeenCalled();
    expect(reservation.status).toBe("confirmed");
    // This tests the UI grid with a synthetic blocked row, not a live database constraint.
    const slots = buildHalfHourSlots({
      dayStartIso: reservation.start_time,
      dayEndIso: reservation.end_time,
      blocked: [reservation],
      isToday: false,
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => !slot.available)).toBe(true);
  });

  it("does not retry old release notices, which may refer to restored bookings", async () => {
    vi.mocked(fetchUnpaidDepositDueReservations).mockResolvedValue([] as never);
    await POST();
    expect(fetchFailedDepositReleaseGroupDeliveries).not.toHaveBeenCalled();
    expect(sendLineFlexBatch).not.toHaveBeenCalled();
  });
});
