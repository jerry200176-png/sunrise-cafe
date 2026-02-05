import { NextRequest, NextResponse } from "next/server";
import {
  getBlockedSlots,
  fetchBranch,
  fetchRoom,
  fetchRoomsWithDetails,
  isAdminConfigured,
} from "@/lib/supabase-admin";

const TAIWAN_OFFSET_HOURS = 8;
const DEFAULT_OPEN = { h: 8, m: 0 };
const DEFAULT_CLOSE = { h: 22, m: 0 };

function parseTime(t: string | null, fallback: { h: number; m: number }): { h: number; m: number } {
  if (!t) return fallback;
  const [h, m] = String(t).split(":").map(Number);
  return { h: Number.isFinite(h) ? h : fallback.h, m: Number.isFinite(m) ? m : fallback.m };
}

function slotRange(date: string, open: { h: number; m: number }, close: { h: number; m: number }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const openStr = `${pad(open.h)}:${pad(open.m)}:00`;
  const closeStr = `${pad(close.h)}:${pad(close.m)}:00`;
  const startLocal = new Date(`${date}T${openStr}+0${TAIWAN_OFFSET_HOURS}:00`);
  const endLocal = new Date(`${date}T${closeStr}+0${TAIWAN_OFFSET_HOURS}:00`);
  if (endLocal.getTime() <= startLocal.getTime()) endLocal.setDate(endLocal.getDate() + 1);
  return { start: startLocal.toISOString(), end: endLocal.toISOString() };
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
  const startMs = new Date(dayStart).getTime();
  const endMs = new Date(dayEnd).getTime();
  const nowMs = isToday ? Date.now() : 0;
  const slots: { start: string; end: string; available: boolean }[] = [];

  for (let t = startMs; t < endMs; t += 60 * 60 * 1000) {
    const slotStart = new Date(t).toISOString();
    const slotEnd = new Date(t + 60 * 60 * 1000).toISOString();
    let available = true;
    if (isToday && t + 60 * 60 * 1000 <= nowMs) {
      available = false;
    } else if (roomBlocked.some((b) => overlaps(slotStart, slotEnd, b.start_time, b.end_time))) {
      available = false;
    }
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
      const open = parseTime(branch.open_time, DEFAULT_OPEN);
      const close = parseTime(branch.close_time, DEFAULT_CLOSE);
      const roomBlocked = blocked.filter((b) => b.room_id === roomId);
      const slots = buildSlotsForRoom(date, open, close, roomBlocked, isToday);
      
      // ✅ 強制更新：直接讀取 image_url，不使用 any
      return NextResponse.json({
        slots,
        roomName: room.name,
        branchName: branch.name,
        openTime: branch.open_time,
        closeTime: branch.close_time,
        image_url: room.image_url, 
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
    const open = parseTime(branch.open_time, DEFAULT_OPEN);
    const close = parseTime(branch.close_time, DEFAULT_CLOSE);

    const roomList = rooms.map((room) => {
      const roomBlocked = blocked.filter((b) => b.room_id === room.id);
      const slots = buildSlotsForRoom(date, open, close, roomBlocked, isToday);
      return {
        roomId: room.id,
        roomName: room.name,
        capacity: room.capacity,
        price_weekday: room.price_weekday,
        price_weekend: room.price_weekend,
        // ✅ 強制更新：直接讀取 image_url
        image_url: room.image_url,
        slots,
      };
    });
    return NextResponse.json({
      rooms: roomList,
      branchName: branch.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法取得時段";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}