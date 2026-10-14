/**
 * 包廂場控 + 現場結帳（pure，無 I/O）。
 *
 * - 包廂狀態：依今日訂位與「現在」判斷空房／即將到店／應到未報到／使用中／快到時間／超時。
 * - 結帳：包廂費（依目前起訖時間，含延時）＋ 餐費 − 已付訂金 = 現場應收。
 * - 延時：新結束時間不得早於開始、不得壓到同包廂下一組（DB exclusion constraint 仍是最後防線）。
 */
import { computeReservationTotalPrice, getDepositAmount, isWeekendDate } from "@/lib/booking-utils";
import { SLOT_STEP_MS } from "@/lib/slot-grid";

/** 快到時間提醒（分鐘） */
export const ENDING_SOON_MINUTES = 15;
/** 即將到店（分鐘） */
export const UPCOMING_MINUTES = 60;
/** 延時快捷鍵：以訂位格線（30 分）為單位的 1、2 格 */
export const EXTEND_STEPS_MINUTES = [1, 2].map((n) => (n * SLOT_STEP_MS) / 60_000);

export type FloorReservation = {
  id: string;
  room_id: string;
  customer_name: string;
  booking_code: string | null;
  start_time: string;
  end_time: string;
  status: string;
  guest_count: number | null;
  total_price: number | null;
  is_deposit_paid: boolean | null;
};

export type RoomFloorStatus = "idle" | "upcoming" | "awaiting" | "in_use" | "ending_soon" | "overtime";

export type RoomFloorState = {
  status: RoomFloorStatus;
  /** 目前占用包廂的那組（已報到，或時段已開始但尚未報到） */
  current: FloorReservation | null;
  /** 同包廂下一組（尚未開始） */
  next: FloorReservation | null;
  /** current 距結束的分鐘數；負數 = 已超時 */
  minutesLeft: number | null;
};

const WAITING = new Set(["pending", "confirmed"]);
const ms = (iso: string) => new Date(iso).getTime();

export function roomFloorState(
  reservations: FloorReservation[],
  nowMs: number,
  opts: { endingSoonMinutes?: number; upcomingMinutes?: number } = {}
): RoomFloorState {
  const endingSoon = opts.endingSoonMinutes ?? ENDING_SOON_MINUTES;
  const upcoming = opts.upcomingMinutes ?? UPCOMING_MINUTES;
  const sorted = [...reservations].sort((a, b) => ms(a.start_time) - ms(b.start_time));

  // 已報到的客人不論時間都算在包廂內（超時就是還沒走）。
  const checkedIn = sorted.find((r) => r.status === "checked_in") ?? null;
  const started = sorted.find((r) => WAITING.has(r.status) && ms(r.start_time) <= nowMs && nowMs < ms(r.end_time)) ?? null;
  const current = checkedIn ?? started;
  const next = sorted.find((r) => WAITING.has(r.status) && ms(r.start_time) > nowMs && r.id !== current?.id) ?? null;
  const minutesLeft = current ? Math.floor((ms(current.end_time) - nowMs) / 60_000) : null;

  let status: RoomFloorStatus = "idle";
  if (checkedIn && minutesLeft !== null) {
    status = minutesLeft < 0 ? "overtime" : minutesLeft <= endingSoon ? "ending_soon" : "in_use";
  } else if (started) {
    status = "awaiting";
  } else if (next && ms(next.start_time) - nowMs <= upcoming * 60_000) {
    status = "upcoming";
  }
  return { status, current, next, minutesLeft };
}

export type BillRoom = { price_weekday: number; price_weekend: number };

export type CheckoutBill = {
  hours: number;
  hourlyRate: number;
  isWeekend: boolean;
  roomFee: number;
  foodTotal: number;
  depositCredit: number;
  due: number;
};

/**
 * 現場帳單。包廂費以「目前」起訖時間重算（延時後自動包含延時費）；
 * 訂金以訂位時的 total_price 計（延時不改 total_price，訂金基礎不變）。
 */
export function computeCheckoutBill(input: {
  room: BillRoom;
  startTime: string;
  endTime: string;
  bookedTotal: number | null;
  isDepositPaid: boolean;
  foodTotal: number;
}): CheckoutBill {
  const isWeekend = isWeekendDate(input.startTime.slice(0, 10));
  const hourlyRate = Number(isWeekend ? input.room.price_weekend : input.room.price_weekday) || 0;
  const hours = Math.max(0, (ms(input.endTime) - ms(input.startTime)) / 3_600_000);
  const roomFee = computeReservationTotalPrice(input.room, input.startTime, input.endTime);
  const foodTotal = Math.round(Number(input.foodTotal) || 0);
  const depositBase = input.bookedTotal ?? roomFee;
  const depositCredit = input.isDepositPaid && depositBase > 0 ? getDepositAmount(depositBase) : 0;
  return {
    hours: Math.round(hours * 100) / 100,
    hourlyRate,
    isWeekend,
    roomFee,
    foodTotal,
    depositCredit,
    due: Math.max(0, roomFee + foodTotal - depositCredit),
  };
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(ms(iso) + minutes * 60_000).toISOString();
}

/** 同包廂、在 current 之後開始、未取消的第一組 —— 延時上限。 */
export function nextBlockingStart(
  current: Pick<FloorReservation, "id" | "room_id" | "end_time" | "start_time">,
  sameRoom: Array<Pick<FloorReservation, "id" | "room_id" | "start_time" | "status">>
): string | null {
  const starts = sameRoom
    .filter((r) => r.id !== current.id && r.room_id === current.room_id && r.status !== "cancelled")
    .filter((r) => ms(r.start_time) >= ms(current.start_time))
    .map((r) => ms(r.start_time))
    .sort((a, b) => a - b);
  return starts.length ? new Date(starts[0]).toISOString() : null;
}

/** 回傳中文錯誤；可調整則回 null。允許提早結束（客人先走），不允許壓到下一組。 */
export function newEndProblem(startTime: string, newEnd: string, nextStart: string | null): string | null {
  const end = ms(newEnd);
  if (!Number.isFinite(end)) return "時間沒填好，請重新選一次";
  if (end <= ms(startTime)) return "結束時間要比開始時間晚";
  if (end % 60_000 !== 0) return "時間請選到整分鐘";
  if (nextStart && end > ms(nextStart)) {
    const hhmm = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })
      .format(new Date(nextStart));
    return `會跟下一組客人（${hhmm} 進場）的時間重疊，請換包廂或先問問下一組`;
  }
  return null;
}

/** 超時補時：把結束時間往後補到涵蓋「現在」的下一個計費格（預設訂位格線 30 分）。未超時回 null。 */
export function overtimeSettledEnd(endTime: string, nowMs: number, stepMinutes = SLOT_STEP_MS / 60_000): string | null {
  const over = nowMs - ms(endTime);
  if (over <= 0) return null;
  const stepMs = stepMinutes * 60_000;
  return new Date(ms(endTime) + Math.ceil(over / stepMs) * stepMs).toISOString();
}
