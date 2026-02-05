import { NextRequest, NextResponse } from "next/server";
import {
  getBlockedSlots,
  fetchBranch,
  fetchRoom,
  fetchRoomsWithDetails,
  isAdminConfigured,
} from "@/lib/supabase-admin";

const TAIWAN_OFFSET_HOURS = 8;
const FALLBACK_OPEN = "08:00";
const FALLBACK_CLOSE = "22:00";

function parseTime(t: string | null, fallback: { h: number; m: number }): { h: number; m: number } {
  if (!t || String(t).trim() === "") return fallback;
  const [h, m] = String(t).split(":").map(Number);
  return { h: Number.isFinite(h) ? h : fallback.h, m: Number.isFinite(m) ? m : fallback.m };
}

function getOpenClose(branch: { open_time: string | null; close_time: string | null }): {
  open: { h: number; m: number };
  close: { h: number; m: number };
  shopOpen: string;
  shopClose: string;
  usedFallback: boolean;
} {
  const openFallback = { h: 8, m: 0 };
  const closeFallback = { h: 22, m: 0 };
  const open = parseTime(branch?.open_time ?? null, openFallback);
  const close = parseTime(branch?.close_time ?? null, closeFallback);
  const usedFallback = !branch?.open_time || !branch?.close_time;
  const shopOpen = `${String(open.h).padStart(2, "0")}:${String(open.m).padStart(2, "0")}`;
  const shopClose = `${String(close.h).padStart(2, "0")}:${String(close.m).padStart(2, "0")}`;
  return { open, close, shopOpen, shopClose, usedFallback };
}

/** 營業時段起訖（台灣 UTC+8）。若 close <= open 則 end 為隔日。 */
function slotRange(date: string, open: { h: number; m: number }, close: { h: number; m: number }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const startLocal = new Date(`${date}T${pad(open.h)}:${pad(open.m)}:00+0${TAIWAN_OFFSET_HOURS}:00`);
  const endLocal = new Date(`${date}T${pad(close.h)}:${pad(close.m)}:00+0${TAIWAN_OFFSET_HOURS}:00`);
  const endAdjusted =
    endLocal.getTime() <= startLocal.getTime()
      ? (() => {
          const d = new Date(endLocal);
          d.setDate(d.getDate() + 1);
          return d;
        })()
      : endLocal;
  return { start: startLocal.toISOString(), end: endAdjusted.toISOString() };
}

function overlaps(
  slotStart: string,
  slotEnd: string,
  bookStart: string,
  bookEnd: string
): boolean {
  return slotStart < bookEnd && slotEnd > bookStart;
}

function buildSlotsForRoom(
  date: string,
  open: { h: number; m: number },
  close: { h: number; m: number },
  roomBlocked: { start_time: string; end_time: string }[],
  isToday: boolean
): { start: string; end: string; available: boolean }[] {
  const { start: dayStart, end: dayEnd } = slotRange(date, open, close);
  let startMs = new Date(dayStart).getTime();
  let endMs = new Date(dayEnd).getTime();
  if (startMs >= endMs) {
    const fallback = slotRange(date, { h: 8, m: 0 }, { h: 22, m: 0 });
    startMs = new Date(fallback.start).getTime();
    endMs = new Date(fallback.end).getTime();
  }
  const nowMs = isToday ? Date.now() : 0;
  const slots: { start: string; end: string; available: boolean }[] = [];
  for (let t = startMs; t < endMs; t += 60 * 60 * 1000) {
    const slotStart = new Date(t).toISOString();
    const slotEnd = new Date(t + 60 * 60 * 1000).toISOString();
    let available = true;
    if (isToday && t + 60 * 60 * 1000 <= nowMs) available = false;
    else if (roomBlocked.some((b) => overlaps(slotStart, slotEnd, b.start_time, b.end_time))) available = false;
    slots.push({ start: slotStart, end: slotEnd, available });
  }
  return slots;
}

export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  const roomId = request.nextUrl.searchParams.get("roomId");
  const date = request.nextUrl.searchParams.get("date");
  if (!branchId || !date) {
    return NextResponse.json(
      { error: "缺少 branchId 或 date (YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date 格式須為 YYYY-MM-DD" }, { status: 400 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }

  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  const taiwanTodayStr = `${y}-${m}-${d}`;
  const isToday = date === taiwanTodayStr;

  try {
    if (roomId) {
      const [branch, room, blocked] = await Promise.all([
        fetchBranch(branchId),
        fetchRoom(roomId),
        getBlockedSlots(branchId, date),
      ]);
      if (!branch || !room || room.branch_id !== branchId) {
        return NextResponse.json({ error: "分店或包廂不存在" }, { status: 404 });
      }
      const { open, close, shopOpen, shopClose, usedFallback } = getOpenClose(branch);
      const roomBlocked = blocked.filter((b) => b.room_id === roomId);
      let slots = buildSlotsForRoom(date, open, close, roomBlocked, isToday);
      if (slots.length === 0) {
        const fallback = getOpenClose({ open_time: FALLBACK_OPEN, close_time: FALLBACK_CLOSE });
        slots = buildSlotsForRoom(date, fallback.open, fallback.close, roomBlocked, isToday);
      }
      return NextResponse.json({
        slots,
        roomName: room.name,
        branchName: branch.name,
        openTime: branch.open_time,
        closeTime: branch.close_time,
        debug: { date, shopOpen, shopClose, blockedCount: roomBlocked.length, usedFallback, slotsCount: slots.length },
      });
    }

    const [branch, rooms, blocked] = await Promise.all([
      fetchBranch(branchId),
      fetchRoomsWithDetails(branchId),
      getBlockedSlots(branchId, date),
    ]);
    if (!branch) {
      return NextResponse.json({ error: "分店不存在" }, { status: 404 });
    }
    const { open, close, shopOpen, shopClose, usedFallback } = getOpenClose(branch);

    const roomList = rooms.map((room) => {
      const roomBlocked = blocked.filter((b) => b.room_id === room.id);
      let slots = buildSlotsForRoom(date, open, close, roomBlocked, isToday);
      if (slots.length === 0) {
        const fallback = getOpenClose({ open_time: FALLBACK_OPEN, close_time: FALLBACK_CLOSE });
        slots = buildSlotsForRoom(date, fallback.open, fallback.close, roomBlocked, isToday);
      }
      return {
        roomId: room.id,
        roomName: room.name,
        capacity: room.capacity,
        price_weekday: room.price_weekday,
        price_weekend: room.price_weekend,
        slots,
      };
    });

    return NextResponse.json({
      rooms: roomList,
      branchName: branch.name,
      debug: {
        date,
        shopOpen,
        shopClose,
        blockedCount: blocked.length,
        usedFallback,
        firstRoomSlotsCount: roomList[0]?.slots?.length ?? 0,
        firstRoomAvailableCount: roomList[0]?.slots?.filter((s: { available: boolean }) => s.available).length ?? 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法取得時段";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
