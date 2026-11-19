import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DETAIL_HEADER, detailCsv, fetchDetailRows, type DetailReservation } from "./report-detail";

const room = { id: "r1", name: "A包廂", branch_id: "b1", branch: { name: "測試店" } };
const base: DetailReservation = {
  booking_code: "ABC12345", status: "completed", total_price: 1001, is_deposit_paid: true, guest_count: 4,
  start_time: "2026-10-31T17:30:00Z", notes: null, room,
};

const lines = (rows: DetailReservation[]) => detailCsv(rows).split("\n");

describe("detailCsv", () => {
  it("one header row, Taipei date/time, deposit rule, settlement money and payment label", () => {
    const out = lines([{
      ...base,
      settlement: [{
        room_fee: 1200, food_total: 300, deposit_credit: 501, discount_amount: 50, discount_reason: "熟客",
        refund_amount: 0, amount_collected: 949, payment_method: "line_pay", settled_at: "2026-10-31T20:05:00Z",
      }],
    }]);
    expect(out[0]).toBe(DETAIL_HEADER.join(","));
    // 17:30Z = 台北 11/01 01:30（跨月跨日都要用台北時間）
    expect(out[1]).toBe("2026-11-01,01:30,測試店,A包廂,ABC12345,已完成,4,1001,501,是,1200,300,501,50,熟客,0,949,LINE Pay,2026-11-01 04:05,");
  });

  it("no settlement leaves money columns blank; notes keep commas, quotes, newlines; formulas are neutralised", () => {
    const out = detailCsv([{ ...base, status: "cancelled", is_deposit_paid: false, total_price: null, room: [room], settlement: null, notes: '=SUM(A1),"VIP"\n第二行' }]);
    expect(out.split("\n")[1]).toBe("2026-11-01,01:30,測試店,A包廂,ABC12345,已取消,4,,,否,,,,,,,,,,\"'=SUM(A1),\"\"VIP\"\"");
    expect(out.endsWith("第二行\"")).toBe(true);
  });

  it("food-only settlement with no money flow shows no payment method", () => {
    const out = lines([{ ...base, settlement: { room_fee: 0, food_total: 0, deposit_credit: 0, discount_amount: 0, discount_reason: null, refund_amount: 0, amount_collected: 0, payment_method: "none", settled_at: "2026-10-31T18:00:00Z" } }]);
    expect(out[1].split(",")[17]).toBe("");
  });
});

describe("fetchDetailRows", () => {
  it("filters the branch on the embed alias (room), and an empty scope never queries", async () => {
    const calls: unknown[][] = [];
    const q: Record<string, unknown> = {};
    for (const k of ["select", "gte", "lt", "order", "range", "in"]) q[k] = (...args: unknown[]) => { calls.push([k, ...args]); return q; };
    q.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
    const db = { from: (t: string) => { calls.push(["from", t]); return q; } } as unknown as SupabaseClient;

    expect(await fetchDetailRows(db, ["b1"], "F", "T")).toEqual([]);
    // PostgREST 對有別名的 embed 要用別名篩選（rooms.branch_id 會 PGRST108）
    expect(calls).toContainEqual(["in", "room.branch_id", ["b1"]]);
    expect(calls).toContainEqual(["gte", "start_time", "F"]);
    expect(calls).toContainEqual(["lt", "start_time", "T"]);

    const before = calls.length;
    expect(await fetchDetailRows(db, [], "F", "T")).toEqual([]);
    expect(calls.length).toBe(before);
  });
});
