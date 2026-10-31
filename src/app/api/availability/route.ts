import { NextRequest, NextResponse } from "next/server";
import {
  getBlockedSlots,
  fetchBranch,
  fetchRoom,
  fetchRoomsWithDetails,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { fetchSettings } from "@/lib/supabase-fetch";
import { resolveDay } from "@/lib/bookable";
import { buildHalfHourSlots } from "@/lib/slot-grid";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Vercel Build Fix: Updated types
type BlockedSlot = { room_id: string; start_time: string; end_time: string };
type RoomDetails = {
  id: string;
  name: string;
  type: string | null;
  min_capacity?: number;
  capacity: number;
  price_weekday: number;
  price_weekend: number;
  image_url: string | null;
};

function buildSlotsForRoom(
  day: { startIso: string; endIso: string },
  roomBlocked: { start_time: string; end_time: string }[],
  isToday: boolean
): { start: string; end: string; available: boolean }[] {
  return buildHalfHourSlots({
    dayStartIso: day.startIso,
    dayEndIso: day.endIso,
    blocked: roomBlocked,
    isToday,
  });
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
    const [settings, branch] = await Promise.all([
      fetchSettings(),
      fetchBranch(branchId),
    ]);
    if (!branch) {
      return NextResponse.json({ error: "分店不存在" }, { status: 404 });
    }
    if (branch.archived_at) {
      return NextResponse.json({ error: "該分店已停止接受線上預約" }, { status: 410 });
    }
    // Same day rules (closed dates, weekly hours, window) as checkBookable.
    const day = resolveDay(branch, settings.closed_dates, date);
    if (day.closed) {
      return NextResponse.json({ closed: true });
    }

    if (roomId) {
      const [room, blockedRaw] = await Promise.all([
        fetchRoom(roomId),
        getBlockedSlots(branchId, date),
      ]);
      const blocked = blockedRaw as BlockedSlot[];
      if (!room || room.branch_id !== branchId) {
        return NextResponse.json({ error: "分店或包廂不存在" }, { status: 404 });
      }
      const roomBlocked = blocked.filter((b) => b.room_id === roomId);
      const slots = buildSlotsForRoom(day, roomBlocked, isToday);

      return NextResponse.json({
        slots,
        roomName: room.name,
        roomType: room.type,
        min_capacity: room.min_capacity,
        branchName: branch.name,
        openTime: day.open,
        closeTime: day.close,
        // ✅ 修正：現在 fetchRoom 已經有正確型別，不需要 as any
        image_url: room.image_url,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const [roomsRaw, blockedRaw] = await Promise.all([
      fetchRoomsWithDetails(branchId),
      getBlockedSlots(branchId, date),
    ]);
    const rooms = roomsRaw as RoomDetails[];
    const blocked = blockedRaw as BlockedSlot[];

    const roomList = rooms.map((room) => {
      const roomBlocked = blocked.filter((b) => b.room_id === room.id);
      const slots = buildSlotsForRoom(day, roomBlocked, isToday);
      return {
        roomId: room.id,
        roomName: room.name,
        roomType: room.type,
        min_capacity: room.min_capacity,
        capacity: room.capacity,
        price_weekday: room.price_weekday,
        price_weekend: room.price_weekend,
        // ✅ 修正：直接讀取
        image_url: room.image_url,
        slots,
      };
    });
    return NextResponse.json({
      rooms: roomList,
      branchName: branch.name,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法取得時段";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
