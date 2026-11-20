/**
 * LINE 聊天室訂位：客人點按鈕選「包廂 → 日期 → 開始時間 → 時長」，最後開已帶好資料的 /book 送出。
 * 純函式：解析 postback、組回覆訊息。對話狀態全放在按鈕的 postback data（不存 DB）。
 * 姓名／電話／人數不在聊天室收，交給 /book（個資不留在聊天紀錄）。
 * @see docs/LINE.md
 */
import { flexBubble, LINE_BOOK_URL, LINE_BRAND, LINE_SITE_URL } from "@/lib/line-flex";
import {
  MIN_DURATION_HOURS,
  availableStarts,
  canSelectStart,
  endIsoForDuration,
  getDurationOptions,
  type GridSlot,
} from "@/lib/slot-grid";
import { formatReservationDateKey, formatTaipeiTime } from "@/lib/datetime";
import { computeReservationTotalPrice } from "@/lib/booking-utils";

export type LineMessage = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** LINE 快速回覆上限 13 顆；留 1 顆給「更晚的時段」。 */
export const STARTS_PER_PAGE = 12;
const CAROUSEL_MAX = 12;

export type BookingStep =
  | { a: "book"; b?: string }
  | { a: "date"; r: string; d: string; o: number }
  | { a: "start"; r: string; d: string; t: string }
  | { a: "dur"; r: string; d: string; t: string; h: number }
  | { a: "mine" }
  | { a: "info" };

type Room = { id: string; name: string; capacity: number; min_capacity?: number; price_weekday: number; price_weekend: number };

/** Postback data → step. `pickedDate` is LINE's datetimepicker result (`postback.params.date`). */
export function parseBookingPostback(data: string, pickedDate?: string): BookingStep | null {
  const q = new URLSearchParams(data);
  const a = q.get("a");
  if (a === "mine" || a === "info") return { a };
  if (a === "book") {
    const b = q.get("b");
    return b && UUID.test(b) ? { a, b } : { a };
  }
  const r = q.get("r") ?? "";
  const d = pickedDate ?? q.get("d") ?? "";
  if (!UUID.test(r) || !DATE.test(d)) return null;
  if (a === "date") {
    const o = Number(q.get("o") ?? 0);
    return { a, r, d, o: Number.isInteger(o) && o > 0 ? o : 0 };
  }
  const t = q.get("t") ?? "";
  if (!Number.isFinite(Date.parse(t))) return null;
  if (a === "start") return { a, r, d, t };
  const h = Number(q.get("h"));
  if (a === "dur" && getDurationOptions().includes(h)) return { a, r, d, t, h };
  return null;
}

const encode = (fields: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(fields).map(([k, v]) => [k, String(v)])).toString();

const quick = (action: Record<string, unknown>) => ({ type: "action", action });
const postback = (label: string, fields: Record<string, string | number>) =>
  quick({ type: "postback", label, data: encode(fields), displayText: label });
const text = (body: string, items: Record<string, unknown>[] = []): LineMessage => ({
  type: "text",
  text: body,
  ...(items.length ? { quickReply: { items } } : {}),
});

function datePicker(label: string, roomId: string, dates: { min: string; max: string }) {
  return { type: "datetimepicker", label, data: encode({ a: "date", r: roomId }), mode: "date", initial: dates.min, min: dates.min, max: dates.max };
}

/** 主選單：加好友的歡迎訊息，也是看不懂的按鈕的退路。 */
export function menuMessage(body = "歡迎來到昇咖啡 ☕ 想做什麼呢？"): LineMessage {
  return text(body, [
    postback("我要訂位", { a: "book" }),
    postback("我的訂位", { a: "mine" }),
    quick({ type: "uri", label: "看菜單", uri: `${LINE_SITE_URL}/menu` }),
    postback("店家資訊", { a: "info" }),
  ]);
}

export function branchChoiceMessage(branches: { id: string; name: string }[]): LineMessage {
  return text("請選擇分店：", branches.slice(0, 13).map((b) => postback(b.name.slice(0, 20), { a: "book", b: b.id })));
}

export function roomsMessage(branchName: string, rooms: Room[], dates: { min: string; max: string }): LineMessage {
  if (rooms.length === 0) return menuMessage(`${branchName}目前沒有開放線上訂位的包廂。`);
  return {
    type: "flex",
    altText: `${branchName}｜請選擇包廂`,
    contents: {
      type: "carousel",
      contents: rooms.slice(0, CAROUSEL_MAX).map((room) =>
        flexBubble({
          icon: "🛋️",
          title: room.name,
          subtitle: branchName,
          rows: [
            { label: "人數", value: room.min_capacity ? `${room.min_capacity}–${room.capacity} 人` : `最多 ${room.capacity} 人` },
            { label: "平日", value: `NT$${room.price_weekday}／小時` },
            { label: "假日", value: `NT$${room.price_weekend}／小時` },
          ],
          note: `最少 ${MIN_DURATION_HOURS} 小時`,
          primaryAction: { label: "選日期", action: datePicker("選日期", room.id, dates) },
        })
      ),
    },
  };
}

/** 這天公休、或沒有任何放得下最短時長的時段。 */
export function dayFullMessage(
  room: { id: string; name: string; branch_id: string },
  date: string,
  dates: { min: string; max: string },
  closed: boolean
): LineMessage {
  const waitlist = `${LINE_BOOK_URL}/waitlist?${encode({ branchId: room.branch_id, roomId: room.id, date })}`;
  return text(
    closed ? `${formatReservationDateKey(date)} 公休，請換一天。` : `${room.name} ${formatReservationDateKey(date)} 已經訂滿了。`,
    [quick(datePicker("換一天", room.id, dates)), ...(closed ? [] : [quick({ type: "uri", label: "排候補", uri: waitlist })])]
  );
}

export function startsMessage(room: { id: string; name: string }, date: string, slots: GridSlot[], offset: number): LineMessage | null {
  const starts = availableStarts(slots, MIN_DURATION_HOURS);
  const page = starts.slice(offset, offset + STARTS_PER_PAGE);
  if (page.length === 0) return null;
  const items = page.map((s) => postback(formatTaipeiTime(s.start), { a: "start", r: room.id, d: date, t: s.start }));
  if (starts.length > offset + STARTS_PER_PAGE) {
    items.push(postback("更晚的時段", { a: "date", r: room.id, d: date, o: offset + STARTS_PER_PAGE }));
  }
  return text(`${room.name}｜${formatReservationDateKey(date)}\n請選開始時間：`, items);
}

export function durationsMessage(room: { id: string; name: string }, date: string, start: string, slots: GridSlot[]): LineMessage | null {
  const hours = getDurationOptions().filter((h) => canSelectStart(slots, start, h));
  if (hours.length === 0) return null;
  return text(
    `${formatTaipeiTime(start)} 開始，要用多久？`,
    hours.map((h) => postback(`${h} 小時（到 ${formatTaipeiTime(endIsoForDuration(start, h))}）`, { a: "dur", r: room.id, d: date, t: start, h }))
  );
}

/** 最後一步：確認卡片 + 開已帶好資料的 /book（姓名、電話、人數在那裡填）。 */
export function confirmMessage(p: {
  branch: { id: string; name: string };
  room: Room;
  date: string;
  start: string;
  hours: number;
  lineUserId: string;
}): LineMessage {
  const end = endIsoForDuration(p.start, p.hours);
  const uri = `${LINE_BOOK_URL}?${encode({
    branchId: p.branch.id,
    branchName: p.branch.name,
    roomId: p.room.id,
    roomName: p.room.name,
    date: p.date,
    start: p.start,
    duration: p.hours,
    line_user_id: p.lineUserId,
  })}`;
  return {
    type: "flex",
    altText: "請確認訂位內容",
    contents: flexBubble({
      icon: "📅",
      title: "還差一步",
      subtitle: p.branch.name,
      rows: [
        { label: "包廂", value: p.room.name },
        { label: "日期", value: formatReservationDateKey(p.date) },
        { label: "時段", value: `${formatTaipeiTime(p.start)}–${formatTaipeiTime(end)}` },
        { label: "包廂費", value: `約 NT$${computeReservationTotalPrice(p.room, p.start, end)}` },
      ],
      note: "時段尚未保留。填完姓名、電話、人數並送出才算訂位成功，金額以送出頁為準。",
      primaryAction: { label: "填資料完成訂位", uri, color: LINE_BRAND.successBright },
    }),
  };
}
