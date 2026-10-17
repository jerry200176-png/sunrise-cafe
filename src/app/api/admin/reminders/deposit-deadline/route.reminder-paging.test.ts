/**
 * #468 review: with auto-cancel gone (ADR-012), expired unpaid bookings stay
 * pending/confirmed forever. The reminder query must not let them fill the
 * PostgREST response cap and starve a later booking that is due a reminder.
 *
 * Uses the real fetchUnpaidDepositDueReservations against an in-memory
 * PostgREST double that, like Supabase, returns at most MAX_ROWS per request.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = 3_600_000;
const MAX_ROWS = 1000; // Supabase/PostgREST default `max-rows`

type Row = Record<string, unknown>;

const m = vi.hoisted(() => ({
  reservations: [] as Record<string, unknown>[],
  requests: 0,
  maxRows: 1000,
  ranges: [] as [number, number][],
  sendLineFlexMessage: vi.fn(async () => undefined),
  updateReservationAdmin: vi.fn(async () => undefined),
  transitionReservation: vi.fn(async () => ({ ok: true })),
}));

/** Minimal PostgREST query double: filters, multi-key order, range, row cap. */
function fakeQuery(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const orders: { col: string; asc: boolean }[] = [];
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  const q = {
    select: () => q,
    in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), q),
    eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
    gt: (col: string, v: string) => (filters.push((r) => String(r[col]) > v), q),
    gte: (col: string, v: string) => (filters.push((r) => String(r[col]) >= v), q),
    lt: (col: string, v: string) => (filters.push((r) => String(r[col]) < v), q),
    lte: (col: string, v: string) => (filters.push((r) => String(r[col]) <= v), q),
    order: (col: string, opts?: { ascending?: boolean }) => (orders.push({ col, asc: opts?.ascending !== false }), q),
    range: (a: number, b: number) => ((from = a), (to = b), q),
    limit: (n: number) => ((to = from + n - 1), q),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      m.requests++;
      m.ranges.push([from, to]);
      const source = table === "reservations" ? (m.reservations as Row[]) : [];
      const rows = source
        .filter((r) => filters.every((f) => f(r)))
        .sort((a, b) => {
          for (const { col, asc } of orders) {
            const x = String(a[col]);
            const y = String(b[col]);
            if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        })
        .slice(from, Number.isFinite(to) ? to + 1 : undefined)
        .slice(0, m.maxRows);
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return q;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (table: string) => fakeQuery(table) }),
}));
vi.mock("@/lib/supabase-admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase-admin")>()),
  isAdminConfigured: vi.fn(() => true),
  updateReservationAdmin: m.updateReservationAdmin,
  fetchFailedDepositReleaseGroupDeliveries: vi.fn(async () => []),
}));
vi.mock("@/lib/line", () => ({ sendLineFlexMessage: m.sendLineFlexMessage }));
vi.mock("@/lib/branch-line-group", () => ({ branchLineGroupIdForReservation: vi.fn(async () => null) }));
vi.mock("@/lib/reservation-lifecycle", () => ({ transitionReservation: m.transitionReservation }));
vi.mock("@/lib/payment-log", () => ({ logPayment: vi.fn(), logDepositStatusChange: vi.fn() }));
vi.mock("@/lib/job-runs", () => ({ runCronJob: vi.fn((_n: string, fn: () => unknown) => fn()) }));
vi.mock("@/lib/cron-request-auth", () => ({ authorizeCronGet: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/bootstrap-migrations", () => ({ runBootstrapMigrations: vi.fn(async () => undefined) }));
vi.mock("@/lib/line-delivery", () => ({
  claimLineReminderDelivery: vi.fn(async () => ({ available: true, id: "delivery" })),
  claimFailedLineReminderDelivery: vi.fn(async () => true),
  markLineReminderDelivery: vi.fn(async () => undefined),
  safeLineDeliveryError: (e: unknown) => String(e),
}));

import { POST } from "./route";

function reservation(id: string, createdOffsetH: number, startOffsetH: number, over: Row = {}): Row {
  const now = Date.now();
  return {
    id,
    booking_code: `C-${id}`,
    customer_name: "客人",
    phone: "0900000000",
    created_at: new Date(now + createdOffsetH * H).toISOString(),
    start_time: new Date(now + startOffsetH * H).toISOString(),
    end_time: new Date(now + (startOffsetH + 2) * H).toISOString(),
    status: "confirmed",
    is_deposit_paid: false,
    line_user_id: `U-${id}`,
    deposit_reminder_sent_at: null,
    deposit_urgent_reminder_sent_at: null,
    room: { id: "room-1", name: "包廂1", branch: { name: "大安店" } },
    ...over,
  };
}

const remindedIds = () =>
  (m.updateReservationAdmin.mock.calls as unknown as [string, Row][])
    .filter(([, patch]) => "deposit_reminder_sent_at" in patch || "deposit_urgent_reminder_sent_at" in patch)
    .map(([id]) => id);

describe("deposit-deadline reminders are not starved by expired unpaid bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.requests = 0;
    m.maxRows = MAX_ROWS;
    m.ranges = [];
  });

  it("more than one response page of old expired unpaid rows + one later eligible booking → it is reminded", async () => {
    const old = Array.from({ length: MAX_ROWS + 250 }, (_, i) =>
      // Expired long ago, never paid, both reminders already sent; stays unpaid (ADR-012).
      reservation(`old-${String(i).padStart(5, "0")}`, -24 * 60 - i, -24 * 30 - i, {
        status: i % 2 ? "pending" : "confirmed",
        deposit_reminder_sent_at: new Date(Date.now() - 24 * 40 * H).toISOString(),
        deposit_urgent_reminder_sent_at: new Date(Date.now() - 24 * 35 * H).toISOString(),
      }),
    );
    // Created 40h ago, starts in 20h → deadline = start − 6h = +14h → first reminder due now.
    const due = reservation("due", -40, 20);
    m.reservations = [...old, due];

    const body = await (await POST()).json();

    expect(body).toMatchObject({ ok: true, reminded: 1, released: 0, errors: 0 });
    expect(remindedIds()).toEqual(["due"]);
    expect(m.sendLineFlexMessage).toHaveBeenCalledTimes(1);
    expect(m.sendLineFlexMessage.mock.calls[0]).toEqual(expect.arrayContaining(["U-due", "訂金提醒"]));
    expect(m.transitionReservation).not.toHaveBeenCalled();
    // Old unpaid bookings are untouched: never cancelled, never re-reminded.
    expect(m.reservations.filter((r) => r.status === "cancelled")).toHaveLength(0);
  });

  it("pages through more than one response of in-window rows in stable order", async () => {
    // Upcoming unpaid bookings inside the reminder window, all already fully reminded.
    const inWindow = Array.from({ length: MAX_ROWS + 50 }, (_, i) =>
      reservation(`win-${String(i).padStart(5, "0")}`, -40, 2, {
        deposit_reminder_sent_at: new Date(Date.now() - 10 * H).toISOString(),
        deposit_urgent_reminder_sent_at: new Date(Date.now() - 1 * H).toISOString(),
      }),
    );
    // Same start_time as the others but sorts last by id; urgent reminder due.
    const urgent = reservation("zz-urgent", -45, 2, {
      deposit_reminder_sent_at: new Date(Date.now() - 10 * H).toISOString(),
    });
    m.reservations = [...inWindow, urgent];

    const body = await (await POST()).json();

    expect(body).toMatchObject({ ok: true, urgentReminded: 1, released: 0, errors: 0 });
    expect(remindedIds()).toEqual(["zz-urgent"]);
    expect(m.requests).toBeGreaterThanOrEqual(2);
  });

  it.each([1, 100, 250])("reads every row with server cap %i, including an exact page boundary", async (cap) => {
    m.maxRows = cap;
    const inWindow = Array.from({ length: cap * 2 - 1 }, (_, i) =>
      reservation(`win-${String(i).padStart(5, "0")}`, -40, 2, {
        deposit_reminder_sent_at: new Date(Date.now() - 10 * H).toISOString(),
        deposit_urgent_reminder_sent_at: new Date(Date.now() - H).toISOString(),
      }),
    );
    const urgent = reservation("zz-urgent", -45, 2, {
      deposit_reminder_sent_at: new Date(Date.now() - 10 * H).toISOString(),
    });
    m.reservations = [urgent, ...inWindow.reverse()];

    const body = await (await POST()).json();

    expect(body).toMatchObject({ ok: true, urgentReminded: 1, released: 0, errors: 0 });
    expect(remindedIds()).toEqual(["zz-urgent"]);
    expect(m.sendLineFlexMessage).toHaveBeenCalledTimes(1);
    expect(m.transitionReservation).not.toHaveBeenCalled();
    expect(m.ranges.map(([from]) => from)).toEqual([0, cap, cap * 2]);
  });
});
