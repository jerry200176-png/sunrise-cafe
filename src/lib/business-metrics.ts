import { getDepositAmount } from "@/lib/booking-utils";

export type MetricReservation = {
  status: string;
  total_price: number | null;
  is_deposit_paid?: boolean | null;
  guest_count?: number | null;
  start_time: string;
};

export type MetricOrder = {
  status: string;
  total_amount: number | null;
  paid_at?: string | null;
};

/** 不算數的訂位狀態。 */
const DEAD = new Set(["cancelled", "rejected"]);

export type BusinessSummary = {
  /** 實收：已確認收到的訂金。 */
  received_deposits: number;
  /** 實收：已結帳的菜單訂單（現場點餐、訂位餐點）。 */
  received_orders: number;
  /** 預計：還沒到的有效訂位金額（尚未發生，不是已收到的錢）。 */
  expected_upcoming: number;
  /** 預計之中，還沒收到的訂金。 */
  unpaid_deposits: number;
  bookings: number;
  guests: number;
  cancelled: number;
  /** 訂金收款率：有付訂金的有效訂位 ÷ 有效訂位。分母就是畫面上的訂位數。 */
  deposit_paid_count: number;
  deposit_rate: number | null;
};

/**
 * 實收與預計分開算，永遠不相加：
 * 實收 = 已付訂金 + 已結帳菜單；預計 = 未來訂位金額。
 */
export function summarizeBusiness(
  reservations: MetricReservation[],
  orders: MetricOrder[],
  now: Date = new Date()
): BusinessSummary {
  const live = reservations.filter((r) => !DEAD.has(r.status));
  const price = (r: MetricReservation) => Number(r.total_price) || 0;

  const paid = live.filter((r) => r.is_deposit_paid);
  const upcoming = live.filter((r) => Date.parse(r.start_time) > now.getTime());

  const paidOrders = orders.filter(
    (o) => o.status !== "cancelled" && (o.paid_at != null || o.status === "completed")
  );

  return {
    received_deposits: paid.reduce((s, r) => s + getDepositAmount(price(r)), 0),
    received_orders: Math.round(paidOrders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0)),
    expected_upcoming: Math.round(upcoming.reduce((s, r) => s + price(r), 0)),
    unpaid_deposits: upcoming
      .filter((r) => !r.is_deposit_paid)
      .reduce((s, r) => s + getDepositAmount(price(r)), 0),
    bookings: live.length,
    guests: live.reduce((s, r) => s + (Number(r.guest_count) || 0), 0),
    cancelled: reservations.length - live.length,
    deposit_paid_count: paid.length,
    deposit_rate: live.length ? Math.round((paid.length / live.length) * 1000) / 1000 : null,
  };
}

/** 台灣沒有夏令時間，固定 +08:00。offset=0 本月、-1 上月。回傳 [起, 迄) 的 ISO。 */
export function taipeiMonthRange(now: Date, offset = 0): { from: string; to: string; label: string } {
  const tw = new Date(now.getTime() + 8 * 3600_000);
  let y = tw.getUTCFullYear();
  let m = tw.getUTCMonth() + offset; // 0-based
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  const iso = (yy: number, mm: number) => {
    const y2 = yy + Math.floor(mm / 12);
    const m2 = ((mm % 12) + 12) % 12;
    return new Date(`${y2}-${String(m2 + 1).padStart(2, "0")}-01T00:00:00+08:00`).toISOString();
  };
  return { from: iso(y, m), to: iso(y, m + 1), label: `${m + 1} 月` };
}
