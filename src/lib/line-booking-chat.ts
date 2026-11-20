/**
 * LINE 聊天室訂位：讀資料、決定回哪些訊息。訊息內容在 line-booking-menu.ts。
 * 空位用和 /api/availability 相同的 resolveDay + roomSlotsForDay；真正寫入仍走 /book → /api/reservations。
 */
import {
  fetchBranch,
  fetchBranches,
  fetchRoom,
  fetchRoomsWithDetails,
  getBlockedSlots,
  supabaseAdmin,
} from "@/lib/supabase-admin";
import { fetchSettings } from "@/lib/supabase-fetch";
import { resolveDay } from "@/lib/bookable";
import { canSelectStart, roomSlotsForDay } from "@/lib/slot-grid";
import { taipeiDatePlusMonths, taipeiDateString } from "@/lib/datetime";
import { branchCustomerBots } from "@/lib/customer-line-bots";
import { flexBubble, LINE_QUERY_URL, LINE_SITE_URL } from "@/lib/line-flex";
import { buildGuestMyBookingFlex } from "@/lib/line-cards";
import { isLookupSigningConfigured, signLookupToken } from "@/lib/lookup-token";
import {
  branchChoiceMessage,
  confirmMessage,
  dayFullMessage,
  durationsMessage,
  menuMessage,
  roomsMessage,
  startsMessage,
  type BookingStep,
  type LineMessage,
} from "@/lib/line-booking-menu";

type Ctx = { userId: string; /** The store whose own account got the event; null = the default account. */ branchId: string | null };
type BlockedSlot = { room_id: string; start_time: string; end_time: string };

/** Same window as the /book date input: today to one month ahead (Taipei). */
const bookingDates = () => ({ min: taipeiDateString(), max: taipeiDatePlusMonths(1) });

/** Stores this account books for: its own store, or every open store without its own customer account. */
async function accountBranches(ctx: Ctx): Promise<{ id: string; name: string; address?: string | null; phone?: string | null }[]> {
  if (ctx.branchId) {
    const branch = await fetchBranch(ctx.branchId);
    return branch && !branch.archived_at ? [branch] : [];
  }
  const own = new Set(branchCustomerBots().map((b) => b.branchId));
  return ((await fetchBranches()) ?? []).filter((b: { id: string }) => !own.has(b.id));
}

async function myBookings(ctx: Ctx): Promise<LineMessage> {
  let query = supabaseAdmin()
    .from("reservations")
    .select("id, booking_code, start_time, end_time, status, room:rooms!inner(name, branch_id)")
    .eq("line_user_id", ctx.userId);
  if (ctx.branchId) query = query.eq("room.branch_id", ctx.branchId);
  const { data } = await query
    .in("status", ["pending", "confirmed"])
    .gte("end_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(10);
  const rows = (data ?? []) as unknown as {
    id: string; booking_code: string | null; start_time: string; end_time: string; status: string; room: { name: string } | null;
  }[];
  if (rows.length === 0) {
    return menuMessage("這個 LINE 帳號目前沒有接下來的訂位。\n若用別的方式訂過，請傳「訂位代號」給我們綁定。");
  }
  const signed = isLookupSigningConfigured();
  return {
    type: "flex",
    altText: `您有 ${rows.length} 筆訂位`,
    contents: {
      type: "carousel",
      contents: rows.map((r) =>
        buildGuestMyBookingFlex({
          roomName: r.room?.name ?? null,
          startTime: r.start_time,
          endTime: r.end_time,
          bookingCode: r.booking_code,
          pending: r.status === "pending",
          queryUrl: signed
            ? `${LINE_QUERY_URL}?token=${encodeURIComponent(signLookupToken(r.id))}`
            : r.booking_code ? `${LINE_QUERY_URL}?code=${encodeURIComponent(r.booking_code)}` : LINE_QUERY_URL,
        })
      ),
    },
  };
}

async function storeInfo(ctx: Ctx): Promise<LineMessage> {
  const branches = await accountBranches(ctx);
  if (branches.length === 0) return menuMessage();
  return {
    type: "flex",
    altText: "店家資訊",
    contents: {
      type: "carousel",
      contents: branches.slice(0, 12).map((b) =>
        flexBubble({
          icon: "📍",
          title: b.name,
          rows: [
            ...(b.address ? [{ label: "地址", value: b.address }] : []),
            ...(b.phone ? [{ label: "電話", value: b.phone }] : []),
          ],
          primaryAction: { label: "開啟昇咖啡官網", uri: LINE_SITE_URL },
        })
      ),
    },
  };
}

/** Messages to reply for one booking postback (or the menu when the button is unreadable/stale). */
export async function bookingReply(step: BookingStep | null, ctx: Ctx): Promise<LineMessage[]> {
  if (!step) return [menuMessage("這個按鈕已經過期，請重新開始：")];
  if (step.a === "mine") return [await myBookings(ctx)];
  if (step.a === "info") return [await storeInfo(ctx)];
  const dates = bookingDates();

  if (step.a === "book") {
    const branches = await accountBranches(ctx);
    // A store's own account only books its own store, whatever the button says.
    const branch = branches.length === 1 ? branches[0] : branches.find((b) => b.id === step.b);
    if (!branch) return [branches.length ? branchChoiceMessage(branches) : menuMessage("目前沒有開放線上訂位的分店。")];
    return [roomsMessage(branch.name, await fetchRoomsWithDetails(branch.id), dates)];
  }

  const room = await fetchRoom(step.r);
  const wrongAccount = room && (ctx.branchId
    ? room.branch_id !== ctx.branchId
    : branchCustomerBots().some((b) => b.branchId === room.branch_id));
  if (!room || wrongAccount) return [menuMessage("找不到這個包廂，請重新開始：")];
  if (step.d < dates.min || step.d > dates.max) return [menuMessage("這個日期已經不能訂了，請重新開始：")];
  const [branch, settings, blocked] = await Promise.all([
    fetchBranch(room.branch_id),
    fetchSettings(),
    getBlockedSlots(room.branch_id, step.d),
  ]);
  if (!branch || branch.archived_at) return [menuMessage("這家分店已停止接受線上預約。")];
  const day = resolveDay(branch, settings.closed_dates, step.d);
  if (day.closed) return [dayFullMessage(room, step.d, dates, true)];
  const date = step.d;
  const slots = roomSlotsForDay(day, blocked as BlockedSlot[], room.id, date === dates.min);
  const starts = (offset: number) => startsMessage(room, date, slots, offset) ?? dayFullMessage(room, date, dates, false);

  if (step.a === "date") return [starts(step.o)];
  if (step.a === "start") return [durationsMessage(room, step.d, step.t, slots) ?? starts(0)];
  if (!canSelectStart(slots, step.t, step.h)) {
    return [{ type: "text", text: "這個時段剛剛被訂走了，請重新選。" }, starts(0)];
  }
  return [confirmMessage({ branch, room, date: step.d, start: step.t, hours: step.h, lineUserId: ctx.userId })];
}
