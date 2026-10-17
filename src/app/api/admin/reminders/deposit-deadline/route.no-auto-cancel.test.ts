/**
 * Founder decision 2026-10-16 (ADR-012): the deposit-deadline job must never
 * cancel a reservation because the deposit is unpaid. It still sends the
 * initial and urgent reminders, and the reservation stays unpaid.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const H = 3_600_000;

const m = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  failedReleases: [] as unknown[],
  updateReservationAdmin: vi.fn(async () => undefined),
  sendLineFlexMessage: vi.fn(async () => undefined),
  sendLineFlexBatch: vi.fn(async () => undefined),
  sendLineFlexBatchToGroup: vi.fn(async () => undefined),
  transitionReservation: vi.fn(async () => ({ ok: true, status: "cancelled" })),
  claimLineReminderDelivery: vi.fn(async () => ({ available: true, id: "delivery-1" })),
  markLineReminderDelivery: vi.fn(async () => undefined),
  logDepositStatusChange: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  fetchUnpaidDepositDueReservations: vi.fn(async () => m.rows),
  fetchFailedDepositReleaseGroupDeliveries: vi.fn(async () => m.failedReleases),
  updateReservationAdmin: m.updateReservationAdmin,
  isAdminConfigured: vi.fn(() => true),
  supabaseAdmin: vi.fn(() => ({})),
}));
vi.mock("@/lib/line", () => ({ sendLineFlexMessage: m.sendLineFlexMessage }));
vi.mock("@/lib/line-notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/line-notify")>()),
  sendLineFlexBatch: m.sendLineFlexBatch,
  sendLineFlexBatchToGroup: m.sendLineFlexBatchToGroup,
}));
vi.mock("@/lib/branch-line-group", () => ({ branchLineGroupIdForReservation: vi.fn(async () => null) }));
vi.mock("@/lib/reservation-lifecycle", () => ({ transitionReservation: m.transitionReservation }));
vi.mock("@/lib/payment-log", () => ({ logPayment: vi.fn(), logDepositStatusChange: m.logDepositStatusChange }));
vi.mock("@/lib/job-runs", () => ({ runCronJob: vi.fn((_name: string, fn: () => unknown) => fn()) }));
vi.mock("@/lib/cron-request-auth", () => ({ authorizeCronGet: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/bootstrap-migrations", () => ({ runBootstrapMigrations: vi.fn(async () => undefined) }));
vi.mock("@/lib/line-delivery", () => ({
  claimLineReminderDelivery: m.claimLineReminderDelivery,
  claimFailedLineReminderDelivery: vi.fn(async () => true),
  markLineReminderDelivery: m.markLineReminderDelivery,
  safeLineDeliveryError: (e: unknown) => String(e),
}));

import { GET, POST } from "./route";

function row(id: string, createdOffsetH: number, startOffsetH: number, over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id,
    booking_code: `CODE-${id}`,
    customer_name: "客人",
    phone: "0900000000",
    created_at: new Date(now + createdOffsetH * H).toISOString(),
    start_time: new Date(now + startOffsetH * H).toISOString(),
    end_time: new Date(now + (startOffsetH + 2) * H).toISOString(),
    status: "confirmed",
    line_user_id: "U-guest",
    deposit_reminder_sent_at: null,
    deposit_urgent_reminder_sent_at: null,
    room: { id: "room-1", name: "包廂1", branch: { name: "大安店" } },
    ...over,
  };
}

const triggers = [
  ["Vercel cron GET", () => GET(new NextRequest("https://test.local/api/admin/reminders/deposit-deadline"))],
  ["manual POST", () => POST()],
] as const;

describe.each(triggers)("deposit-deadline via %s — no automatic cancellation", (_label, trigger) => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.failedReleases = [];
  });

  it("an unpaid reservation past the former deadline is not cancelled and not notified as cancelled", async () => {
    // created 72h ago, starts in 2h → old deadline = start − 6h, already 4h past.
    m.rows = [
      row("past", -72, 2, {
        deposit_reminder_sent_at: new Date(Date.now() - 30 * H).toISOString(),
        deposit_urgent_reminder_sent_at: new Date(Date.now() - 8 * H).toISOString(),
      }),
      // A pending one without LINE that is long past its deadline.
      row("past-no-line", -96, 1, { status: "pending", line_user_id: null }),
    ];

    const res = await trigger();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, released: 0, errors: 0 });
    expect(m.transitionReservation).not.toHaveBeenCalled();
    expect(m.logDepositStatusChange).not.toHaveBeenCalled();
    expect(m.updateReservationAdmin).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(m.sendLineFlexMessage).not.toHaveBeenCalled();
    expect(m.sendLineFlexBatch).not.toHaveBeenCalled();
    expect(m.sendLineFlexBatchToGroup).not.toHaveBeenCalled();
    const claimTypes = (m.claimLineReminderDelivery.mock.calls as unknown as [{ reminderType: string }][])
      .map(([input]) => input.reminderType);
    expect(claimTypes).not.toContain("deposit_release_guest");
    expect(claimTypes).not.toContain("deposit_release_group");
  });

  it("still sends the first reminder inside the 24h window", async () => {
    // created 40h ago, starts in 20h → deadline = start − 6h = +14h.
    m.rows = [row("first", -40, 20)];

    const body = await (await trigger()).json();

    expect(body).toMatchObject({ ok: true, reminded: 1, released: 0 });
    expect(m.sendLineFlexMessage).toHaveBeenCalledTimes(1);
    expect(m.sendLineFlexMessage.mock.calls[0]).toEqual(
      expect.arrayContaining(["U-guest", "訂金提醒"]),
    );
    expect(m.updateReservationAdmin).toHaveBeenCalledWith(
      "first",
      expect.objectContaining({ deposit_reminder_sent_at: expect.any(String) }),
    );
    expect(m.transitionReservation).not.toHaveBeenCalled();
  });

  it("still sends the urgent reminder when the deadline is ≤6h away", async () => {
    // created 45h ago, starts in 8h → deadline = created + 48h = +3h.
    m.rows = [row("urgent", -45, 8, { deposit_reminder_sent_at: new Date(Date.now() - 10 * H).toISOString() })];

    const body = await (await trigger()).json();

    expect(body).toMatchObject({ ok: true, urgentReminded: 1, released: 0 });
    expect(m.sendLineFlexMessage).toHaveBeenCalledTimes(1);
    expect(m.sendLineFlexMessage.mock.calls[0]).toEqual(
      expect.arrayContaining(["U-guest", "訂金即將逾期"]),
    );
    expect(m.updateReservationAdmin).toHaveBeenCalledWith(
      "urgent",
      expect.objectContaining({ deposit_urgent_reminder_sent_at: expect.any(String) }),
    );
    expect(m.transitionReservation).not.toHaveBeenCalled();
  });
});
