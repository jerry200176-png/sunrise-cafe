import { NextRequest, NextResponse } from "next/server";
import {
  getBlockedSlots,
  fetchBranch,
  fetchRoom,
  isAdminConfigured,
} from "@/lib/supabase-admin";

function parseTime(t: string | null): { h: number; m: number } {
  if (!t) return { h: 9, m: 0 };
  const [h, m] = String(t).split(":").map(Number);
  return { h: Number.isFinite(h) ? h : 9, m: Number.isFinite(m) ? m : 0 };
}

/** 該日 00:00 UTC 起算的 slot 起訖（ISO） */
function slotRange(date: string, open: { h: number; m: number }, close: { h: number; m: number }) {
  const day = date.replace(/-/g, "");
  const start = `${day}T${String(open.h).padStart(2, "0")}:${String(open.m).padStart(2, "0")}:00.000Z`;
  const end = `${day}T${String(close.h).padStart(2, "0")}:${String(close.m).padStart(2, "0")}:00.000Z`;
  return { start, end };
}

function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  const roomId = request.nextUrl.searchParams.get("roomId");
  const date = request.nextUrl.searchParams.get("date");
  if (!branchId || !roomId || !date) {
    return NextResponse.json(
      { error: "缺少 branchId、roomId 或 date (YYYY-MM-DD)" },
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
  try {
    const [branch, room, blocked] = await Promise.all([
      fetchBranch(branchId),
      fetchRoom(roomId),
      getBlockedSlots(branchId, date),
    ]);
    if (!branch || !room || room.branch_id !== branchId) {
      return NextResponse.json({ error: "分店或包廂不存在" }, { status: 404 });
    }
    const open = parseTime(branch.open_time);
    const close = parseTime(branch.close_time);
    const { start: dayStart, end: dayEnd } = slotRange(date, open, close);
    const roomBlocked = blocked.filter((b) => b.room_id === roomId);
    const slots: { start: string; end: string; available: boolean }[] = [];
    const startMs = new Date(dayStart).getTime();
    const endMs = new Date(dayEnd).getTime();
    for (let t = startMs; t < endMs; t += 60 * 60 * 1000) {
      const slotStart = new Date(t).toISOString();
      const slotEnd = new Date(t + 60 * 60 * 1000).toISOString();
      const taken = roomBlocked.some((b) =>
        overlaps(slotStart, slotEnd, b.start_time, b.end_time)
      );
      slots.push({
        start: slotStart,
        end: slotEnd,
        available: !taken,
      });
    }
    return NextResponse.json({
      slots,
      roomName: room.name,
      branchName: branch.name,
      openTime: branch.open_time,
      closeTime: branch.close_time,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法取得時段";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
