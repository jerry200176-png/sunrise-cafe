import type { SupabaseClient } from "@supabase/supabase-js";
import { getDepositAmount } from "@/lib/booking-utils";
import { csvRow } from "@/lib/csv";
import { formatTaipeiTime, reservationDateKey } from "@/lib/datetime";
import { fetchAll, type RoomInfo } from "@/lib/overview-data";
import { PAYMENT_METHODS } from "@/lib/room-settlement";
import { reservationStatusLabel } from "@/lib/status-labels";

/** 做帳用的每筆訂位明細：金額、結帳與備註。不含客人姓名與電話（用訂位代號對帳）。 */
type Settlement = {
  room_fee: number;
  food_total: number;
  deposit_credit: number;
  discount_amount: number;
  discount_reason: string | null;
  refund_amount: number;
  amount_collected: number;
  payment_method: string;
  settled_at: string;
};

export type DetailReservation = {
  booking_code: string;
  status: string;
  total_price: number | null;
  is_deposit_paid: boolean | null;
  guest_count: number | null;
  start_time: string;
  notes: string | null;
  room: RoomInfo | RoomInfo[] | null;
  settlement?: Settlement | Settlement[] | null;
};

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const paymentLabel = (m: string) => (m === "none" ? "" : PAYMENT_METHODS.find((p) => p.value === m)?.label ?? m);

export const DETAIL_HEADER = [
  "日期", "開始", "分店", "包廂", "訂位代號", "狀態", "人數",
  "訂位金額", "訂金", "訂金已付", "包廂費", "餐費", "訂金折抵", "折扣", "折扣原因", "退款",
  "結帳實收", "付款方式", "結帳時間", "備註",
];

export function detailCsv(rows: DetailReservation[]): string {
  return [DETAIL_HEADER, ...rows.map((r) => {
    const room = one(r.room);
    const s = one(r.settlement);
    const price = r.total_price == null ? null : Number(r.total_price);
    return [
      reservationDateKey(r.start_time), formatTaipeiTime(r.start_time), one(room?.branch)?.name, room?.name,
      r.booking_code, reservationStatusLabel(r.status), r.guest_count,
      price, price == null ? null : getDepositAmount(price), r.is_deposit_paid ? "是" : "否",
      s?.room_fee, s?.food_total, s?.deposit_credit, s?.discount_amount, s?.discount_reason, s?.refund_amount,
      s?.amount_collected, s ? paymentLabel(s.payment_method) : null,
      s ? `${reservationDateKey(s.settled_at)} ${formatTaipeiTime(s.settled_at)}` : null,
      r.notes,
    ];
  })].map(csvRow).join("\n");
}

/** [from, to) 內開始的訂位；scope 規則同 fetchReportRows（null = 不限分店，空陣列 = 不查）。 */
export async function fetchDetailRows(db: SupabaseClient, scope: string[] | null, from: string, to: string) {
  if (scope !== null && scope.length === 0) return [] as DetailReservation[];
  const base = "booking_code,status,total_price,is_deposit_paid,guest_count,start_time,notes,room:rooms!inner(id,name,branch_id,branch:branches(name))";
  const read = (columns: string) => fetchAll<DetailReservation>((a, b) => {
    let q = db.from("reservations").select(columns).gte("start_time", from).lt("start_time", to).order("start_time").range(a, b);
    if (scope) q = q.in("room.branch_id", scope); // embed 有別名 room，篩選要用別名（同 webhooks/line）
    return q as unknown as PromiseLike<{ data: DetailReservation[] | null; error: { message: string } | null }>;
  });
  // 結帳紀錄表還沒套用 migration 時，只匯出訂位本身的欄位
  return read(`${base},settlement:reservation_settlements(room_fee,food_total,deposit_credit,discount_amount,discount_reason,refund_amount,amount_collected,payment_method,settled_at)`)
    .catch((error: Error) => {
      if (/reservation_settlements/.test(error.message)) return read(base);
      throw error;
    });
}
