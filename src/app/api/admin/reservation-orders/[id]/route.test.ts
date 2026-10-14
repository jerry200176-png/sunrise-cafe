import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Call = { table: string; ops: Array<[string, unknown[]]> };
type Reply = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getAdminContext: vi.fn(),
  getReservationForPreorder: vi.fn(),
  getReservationPreorder: vi.fn(),
  transitionReservation: vi.fn(),
  logOps: vi.fn(),
  afterSettledComplete: vi.fn(),
  rpc: vi.fn(),
  calls: [] as Call[],
  respond: (() => ({ data: null, error: null })) as (call: Call) => Reply,
}));

function builder(table: string) {
  const call: Call = { table, ops: [] };
  mocks.calls.push(call);
  const self: Record<string, unknown> = {};
  for (const op of ["select", "eq", "neq", "gte", "is", "order", "limit", "in", "update", "insert", "delete"]) {
    self[op] = (...args: unknown[]) => { call.ops.push([op, args]); return self; };
  }
  self.single = () => Promise.resolve(mocks.respond(call));
  self.maybeSingle = () => Promise.resolve(mocks.respond(call));
  self.then = (ok: (value: Reply) => unknown, fail: (reason: unknown) => unknown) => Promise.resolve(mocks.respond(call)).then(ok, fail);
  return self;
}

vi.mock("@/lib/admin-api-auth", () => ({ requirePermission: mocks.requirePermission, getAdminContext: mocks.getAdminContext }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: () => ({ from: builder, rpc: mocks.rpc }) }));
vi.mock("@/lib/reservation-preorder", () => ({
  getReservationForPreorder: mocks.getReservationForPreorder,
  getReservationPreorder: mocks.getReservationPreorder,
  validateAndSnapshotItems: vi.fn(),
  canonicalDraftItems: vi.fn(),
}));
vi.mock("@/lib/reservation-lifecycle", () => ({
  transitionReservation: mocks.transitionReservation,
  afterSettledComplete: mocks.afterSettledComplete,
  transitionHttp: () => ({ status: 409, body: { error: "blocked" } }),
}));
vi.mock("@/lib/ops-log", () => ({ logOps: mocks.logOps }));

import { POST } from "./route";

const at = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00+08:00`).toISOString();
const reservationRow = { id: "res-1", room_id: "room-a", start_time: at("14:00"), end_time: at("16:00"), status: "checked_in",
  total_price: 400, is_deposit_paid: true, room: { price_weekday: 200, price_weekend: 300 } };
let order: { id: string; paid_at: string | null; total_amount: number; order_items: unknown[] };
let nextGroups: Array<{ id: string; room_id: string; start_time: string; status: string }>;

const hasOp = (call: Call, op: string) => call.ops.some(([name]) => name === op);

function post(body: Record<string, unknown>) {
  return POST(new NextRequest("http://localhost/api/admin/reservation-orders/res-1", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "res-1" }) });
}

describe("POST /api/admin/reservation-orders/[id] — extend & checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    order = { id: "ord-1", paid_at: null, total_amount: 360, order_items: [] };
    nextGroups = [{ id: "res-2", room_id: "room-a", start_time: at("17:00"), status: "confirmed" }];
    mocks.requirePermission.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({ user_id: "staff-1", role: "staff" });
    mocks.getReservationPreorder.mockResolvedValue(null);
    mocks.getReservationForPreorder.mockResolvedValue({ id: "res-1", status: "checked_in", room: { name: "A", branch_id: "b1" } });
    mocks.transitionReservation.mockResolvedValue({ ok: true, status: "completed" });
    mocks.respond = (call) => {
      if (call.table === "orders" && hasOp(call, "update")) return { data: [{ id: "ord-1" }], error: null };
      if (call.table === "orders") return { data: order, error: null };
      if (call.table === "reservations" && hasOp(call, "update")) return { data: [{ id: "res-1" }], error: null };
      if (call.table === "reservations" && hasOp(call, "limit")) return { data: nextGroups, error: null };
      if (call.table === "reservations") return { data: reservationRow, error: null };
      // migration 尚未套用：延長紀錄表不存在 → 舊流程
      if (call.table === "reservation_extensions") return { data: null, error: { code: "PGRST205", message: "missing" } };
      return { data: null, error: null };
    };
  });

  it("extends the end time within the next group's start and returns the recomputed bill", async () => {
    const response = await post({ action: "extend", end_time: at("17:00") });
    expect(response.status).toBe(200);
    const update = mocks.calls.find((c) => c.table === "reservations" && hasOp(c, "update"))!;
    expect(update.ops.find(([op]) => op === "update")![1][0]).toEqual({ end_time: at("17:00") });
    expect(update.ops).toContainEqual(["eq", ["status", "checked_in"]]);
    const json = await response.json();
    expect(json.billing.next_start).toBe(at("17:00"));
    expect(json.billing.bill).toMatchObject({ foodTotal: 360 });
    expect(mocks.logOps).toHaveBeenCalledWith("admin", "admin.reservation_extended", expect.objectContaining({ to: at("17:00") }));
  });

  it("never writes total_price on extend (no deposit re-request)", async () => {
    await post({ action: "extend", end_time: at("16:30") });
    const update = mocks.calls.find((c) => c.table === "reservations" && hasOp(c, "update"))!;
    expect(Object.keys(update.ops.find(([op]) => op === "update")![1][0] as object)).toEqual(["end_time"]);
  });

  it("refuses to overlap the next group in the same room", async () => {
    const response = await post({ action: "extend", end_time: at("17:30") });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/下一組/);
    expect(mocks.calls.some((c) => c.table === "reservations" && hasOp(c, "update"))).toBe(false);
  });

  it("maps a DB exclusion violation to 409", async () => {
    nextGroups = [];
    const base = mocks.respond;
    mocks.respond = (call) => call.table === "reservations" && hasOp(call, "update")
      ? { data: null, error: { code: "23P01", message: "conflicting key value violates exclusion constraint" } } : base(call);
    const response = await post({ action: "extend", end_time: at("18:00") });
    expect(response.status).toBe(409);
  });

  it("refuses extend before check-in but allows it after a food-only settlement", async () => {
    mocks.getReservationForPreorder.mockResolvedValue({ id: "res-1", status: "confirmed", room: { name: "A", branch_id: "b1" } });
    expect((await post({ action: "extend", end_time: at("16:30") })).status).toBe(409);
    mocks.getReservationForPreorder.mockResolvedValue({ id: "res-1", status: "checked_in", room: { name: "A", branch_id: "b1" } });
    order.paid_at = at("15:00");
    expect((await post({ action: "extend", end_time: at("16:30") })).status).toBe(200);
  });

  // 14:00–16:00 weekday at 200/h = 400, food 360, paid deposit 50% of 400 = 200 → due 560
  const DUE = 560;
  const writesPaidAt = (call: Call) => call.table === "orders"
    && call.ops.some(([op, args]) => op === "update" && "paid_at" in (args[0] as object));
  const paidUpdate = () => mocks.calls.find(writesPaidAt);

  it("checkout records payment, then completes the reservation", async () => {
    const order: string[] = [];
    mocks.transitionReservation.mockImplementation(async () => { order.push("complete"); return { ok: true, status: "completed" }; });
    const base = mocks.respond;
    mocks.respond = (call) => { if (writesPaidAt(call)) order.push("paid"); return base(call); };
    const response = await post({ action: "checkout", expected_due: DUE });
    expect(response.status).toBe(200);
    expect(order).toEqual(["paid", "complete"]);
    expect(mocks.transitionReservation).toHaveBeenCalledWith("res-1", { type: "complete" }, expect.objectContaining({ kind: "admin" }));
    expect(mocks.logOps).toHaveBeenCalledWith("admin", "admin.room_checked_out", expect.objectContaining({ reservation_id: "res-1", due: DUE }));
  });

  it("checkout refuses when the confirmed amount no longer matches, and writes nothing", async () => {
    const response = await post({ action: "checkout", expected_due: DUE - 100 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/金額剛剛有變動/);
    expect(mocks.transitionReservation).not.toHaveBeenCalled();
    expect(paidUpdate()).toBeUndefined();
    expect((await post({ action: "checkout" })).status).toBe(409);
  });

  it("checkout does not charge food again when the order was already settled", async () => {
    order.paid_at = at("15:00");
    const stale = await post({ action: "checkout", expected_due: DUE });
    expect(stale.status).toBe(409);
    const response = await post({ action: "checkout", expected_due: DUE - 360 });
    expect(response.status).toBe(200);
    expect(paidUpdate()).toBeUndefined();
    expect(mocks.transitionReservation).toHaveBeenCalledTimes(1);
  });

  it("checkout stops with 409 when another terminal recorded the payment first", async () => {
    const base = mocks.respond;
    mocks.respond = (call) => writesPaidAt(call) ? { data: [], error: null } : base(call);
    const response = await post({ action: "checkout", expected_due: DUE });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/另一台/);
    expect(mocks.transitionReservation).not.toHaveBeenCalled();
  });

  it("does not credit a refunded deposit", async () => {
    const base = mocks.respond;
    mocks.respond = (call) => call.table === "reservations" && !hasOp(call, "update") && !hasOp(call, "limit")
      ? { data: { ...reservationRow, deposit_status: "refunded" }, error: null } : base(call);
    const response = await post({ action: "checkout", expected_due: DUE + 200 });
    expect(response.status).toBe(200);
  });

  it("checkout undoes payment when items changed between the amount check and the payment write", async () => {
    const base = mocks.respond;
    mocks.respond = (call) => call.table === "orders" && call.ops.some(([op, args]) => op === "select" && args[0] === "total_amount")
      ? { data: { total_amount: 480 }, error: null } : base(call);
    const response = await post({ action: "checkout", expected_due: DUE });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/金額變了/);
    expect(mocks.transitionReservation).not.toHaveBeenCalled();
    expect(mocks.calls.filter((c) => c.table === "orders"
      && c.ops.some(([op, args]) => op === "update" && (args[0] as { paid_at?: unknown }).paid_at === null))).toHaveLength(1);
  });

  const undoWrites = () => mocks.calls.filter((c) => c.table === "orders"
    && c.ops.some(([op, args]) => op === "update" && (args[0] as { paid_at?: unknown }).paid_at === null));

  it("checkout undoes its own payment write when the lifecycle refuses completion", async () => {
    mocks.transitionReservation.mockResolvedValue({ ok: false, code: "invalid_transition", message: "x", httpStatus: 409 });
    expect((await post({ action: "checkout", expected_due: DUE })).status).toBe(409);
    const written = (paidUpdate()!.ops.find(([op]) => op === "update")![1][0] as { paid_at: string }).paid_at;
    const undo = undoWrites();
    expect(undo).toHaveLength(1);
    expect(undo[0].ops).toContainEqual(["eq", ["paid_at", written]]);
  });

  it("checkout undoes its payment write when the lifecycle throws", async () => {
    mocks.transitionReservation.mockRejectedValue(new Error("boom"));
    expect((await post({ action: "checkout", expected_due: DUE })).status).toBe(500);
    expect(undoWrites()).toHaveLength(1);
  });

  it("checkout keeps the payment when the lifecycle throws after already completing the stay", async () => {
    mocks.transitionReservation.mockRejectedValue(new Error("side effect failed"));
    mocks.respond = ((base) => (call: Call) => call.table === "reservations" && call.ops.some(([op, args]) => op === "select" && args[0] === "status")
      ? { data: { status: "completed" }, error: null } : base(call))(mocks.respond);
    expect((await post({ action: "checkout", expected_due: DUE })).status).toBe(200);
    expect(undoWrites()).toHaveLength(0);
  });
  it("blocks adding or changing dishes after the stay is completed, but still allows marking served", async () => {
    mocks.getReservationForPreorder.mockResolvedValue({ id: "res-1", status: "completed", room: { name: "A", branch_id: "b1" } });
    for (const body of [
      { action: "add_items", items: [{ menu_item_id: "m1", quantity: 1 }] },
      { action: "replace_item", item_id: "i1", item: { menu_item_id: "m1", quantity: 1 } },
      { action: "update_quantity", item_id: "i1", quantity: 2 },
      { action: "remove_item", item_id: "i1" },
    ]) {
      expect((await post(body)).status, body.action).toBe(409);
    }
    expect(mocks.calls.some((call) => call.table === "order_items")).toBe(false);
    mocks.respond = ((base) => (call: Call) => call.table === "order_items" ? { data: [{ id: "i1" }], error: null } : base(call))(mocks.respond);
    expect((await post({ action: "serve_item", item_id: "i1" })).status).toBe(200);
  });

  it("checks a restored reservation back in through the lifecycle, keeping its existing order", async () => {
    mocks.getReservationForPreorder.mockResolvedValue({ id: "res-1", status: "confirmed", room: { name: "A", branch_id: "b1" } });
    mocks.transitionReservation.mockResolvedValue({ ok: true, status: "checked_in" });
    expect((await post({ action: "check_in" })).status).toBe(200);
    expect(mocks.transitionReservation).toHaveBeenCalledWith("res-1", { type: "check_in" }, expect.objectContaining({ kind: "admin" }));
    expect(mocks.calls.some((call) => call.table === "orders" && hasOp(call, "insert"))).toBe(false);
  });
  it("extend is conditional on the end time it read, so a concurrent extension gets 409", async () => {
    await post({ action: "extend", end_time: at("16:30") });
    const update = mocks.calls.find((call) => call.table === "reservations" && hasOp(call, "update"))!;
    expect(update.ops).toContainEqual(["eq", ["end_time", reservationRow.end_time]]);
    mocks.respond = ((base) => (call: Call) => call.table === "reservations" && hasOp(call, "update") ? { data: [], error: null } : base(call))(mocks.respond);
    expect((await post({ action: "extend", end_time: at("16:30") })).status).toBe(409);
  });

  it("refuses room checkout before the group has checked in", async () => {
    mocks.getReservationForPreorder.mockResolvedValue({ id: "res-1", status: "confirmed", room: { name: "A", branch_id: "b1" } });
    expect((await post({ action: "checkout", expected_due: DUE })).status).toBe(409);
    expect(mocks.calls.some(writesPaidAt)).toBe(false);
    expect(mocks.transitionReservation).not.toHaveBeenCalled();
  });
  it("checkout also requires the confirmed refund to match", async () => {
    mocks.respond = ((base) => (call: Call) => call.table === "reservations" && !hasOp(call, "update") && !hasOp(call, "limit")
      ? { data: { ...reservationRow, end_time: at("14:30") }, error: null } : base(call))(mocks.respond);
    order.total_amount = 0;
    // 14:00–14:30 at 200/h = 100, deposit 200 → refund 100
    expect((await post({ action: "checkout", expected_due: 0, expected_refund: 50 })).status).toBe(409);
    expect(mocks.calls.some(writesPaidAt)).toBe(false);
    expect((await post({ action: "checkout", expected_due: 0, expected_refund: 100 })).status).toBe(200);
  });
  it("refuses to mark dishes served before a restored group checks in", async () => {
    mocks.getReservationForPreorder.mockResolvedValue({ id: "res-1", status: "confirmed", room: { name: "A", branch_id: "b1" } });
    expect((await post({ action: "serve_item", item_id: "i1" })).status).toBe(409);
    expect(mocks.calls.some((call) => call.table === "order_items")).toBe(false);
  });
});

describe("POST /api/admin/reservation-orders/[id] — settlement RPCs (#444 migration applied)", () => {
  let extensions: Array<{ minutes: number; fee: number }>;
  let status: string;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    extensions = [];
    status = "checked_in";
    order = { id: "ord-1", paid_at: null, total_amount: 360, order_items: [] };
    nextGroups = [{ id: "res-2", room_id: "room-a", start_time: at("17:00"), status: "confirmed" }];
    mocks.requirePermission.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({ user_id: "staff-1", role: "staff" });
    mocks.getReservationPreorder.mockResolvedValue(null);
    mocks.getReservationForPreorder.mockImplementation(async () => ({ id: "res-1", status, room: { name: "A", branch_id: "b1" } }));
    mocks.rpc.mockResolvedValue({ data: { id: "set-1" }, error: null });
    mocks.respond = (call) => {
      if (call.table === "reservation_extensions") return { data: extensions, error: null };
      if (call.table === "orders" && hasOp(call, "update")) return { data: [{ id: "ord-1" }], error: null };
      if (call.table === "orders") return { data: order, error: null };
      if (call.table === "reservations" && hasOp(call, "limit")) return { data: nextGroups, error: null };
      if (call.table === "reservations") return { data: { ...reservationRow, status }, error: null };
      return { data: null, error: null };
    };
  });

  it("bills the booked price plus recorded extension fees, not the current hourly rate", async () => {
    // 預約 400，延長紀錄 +150（當時費率）；目前房價 200/hr 不影響
    extensions = [{ minutes: 30, fee: 150 }];
    const checkout = await post({ action: "checkout", expected_due: 400 + 150 + 360 - 200, expected_refund: 0, payment_method: "cash" });
    expect(checkout.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("settle_reservation_checkout", expect.objectContaining({
      p_reservation_id: "res-1", p_expected_before_discount: 710, p_expected_refund: 0, p_payment_method: "cash", p_amount_collected: 710,
      p_discount_amount: 0, p_actor_role: "staff",
    }));
    // 不再自己寫 paid_at 或走狀態轉換：都在 RPC 的 transaction 裡
    expect(mocks.calls.some((c) => c.table === "orders" && hasOp(c, "update") && JSON.stringify(c.ops).includes("paid_at"))).toBe(false);
    expect(mocks.transitionReservation).not.toHaveBeenCalled();
    expect(mocks.afterSettledComplete).toHaveBeenCalledWith("res-1", expect.objectContaining({ kind: "admin" }), "checked_in");
  });

  it("passes a manager discount through and charges the discounted amount", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "mgr-1", role: "branch_manager" });
    const response = await post({ action: "checkout", expected_due: 560, expected_refund: 0, payment_method: "card",
      discount_amount: 60, discount_reason: "熟客" });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("settle_reservation_checkout", expect.objectContaining({
      p_expected_before_discount: 560, p_amount_collected: 500, p_discount_amount: 60, p_discount_reason: "熟客", p_actor_role: "branch_manager",
    }));
  });

  it("requires a payment method when money changes hands", async () => {
    const response = await post({ action: "checkout", expected_due: 560, expected_refund: 0 });
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["amount_changed", 409], ["already_settled", 409], ["discount_not_allowed", 409], ["discount_reason_required", 409],
  ])("maps the RPC's %s to a readable %i", async (code, httpStatus) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: code } });
    const response = await post({ action: "checkout", expected_due: 560, expected_refund: 0, payment_method: "cash" });
    expect(response.status).toBe(httpStatus);
    expect((await response.json()).error).not.toBe(code);
    expect(mocks.afterSettledComplete).not.toHaveBeenCalled();
  });

  it("still returns success when the follow-up effects fail after the RPC committed", async () => {
    mocks.afterSettledComplete.mockRejectedValue(new Error("line down"));
    const response = await post({ action: "checkout", expected_due: 560, expected_refund: 0, payment_method: "cash" });
    expect(response.status).toBe(200);
    expect(mocks.logOps).toHaveBeenCalledWith("admin", "admin.room_checkout_side_effect_failed", expect.anything());
  });

  it("extends through extend_reservation_stay with the end time it read", async () => {
    const response = await post({ action: "extend", end_time: at("16:30") });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("extend_reservation_stay", expect.objectContaining({
      p_reservation_id: "res-1", p_expected_end: at("16:00"), p_new_end: at("16:30"),
    }));
    expect(mocks.calls.some((c) => c.table === "reservations" && hasOp(c, "update"))).toBe(false);
  });

  it("maps a concurrent extension and a slot conflict to 409", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "stale_end_time" } });
    expect((await post({ action: "extend", end_time: at("16:30") })).status).toBe(409);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23P01", message: "conflicting key value" } });
    expect((await post({ action: "extend", end_time: at("16:30") })).status).toBe(409);
  });

  it("lets a stay extend past a group that was marked no_show", async () => {
    nextGroups = [{ id: "res-2", room_id: "room-a", start_time: at("16:30"), status: "no_show" }];
    const response = await post({ action: "extend", end_time: at("17:30") });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("extend_reservation_stay", expect.anything());
  });

  it("settles leftover food on a cancelled stay as a food-only settlement", async () => {
    status = "cancelled";
    const response = await post({ action: "settle", payment_method: "line_pay" });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("settle_reservation_checkout", expect.objectContaining({
      p_expected_before_discount: 360, p_expected_refund: 0, p_payment_method: "line_pay", p_amount_collected: 360,
    }));
  });

  it("keeps the in-room food-only payment on the old path so room checkout can follow", async () => {
    const response = await post({ action: "settle" });
    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.calls.some((c) => c.table === "orders" && hasOp(c, "update") && hasOp(c, "is"))).toBe(true);
  });
});
