import { NextRequest, NextResponse } from "next/server";
import {
  insertReservationAdmin,
  hasSlotConflict,
  fetchRoom,
  isAdminConfigured,
} from "@/lib/supabase-admin";

function getPriceForDate(room: { price_weekday: number; price_weekend: number }, dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const isWeekend = day === 0 || day === 6;
  return isWeekend ? Number(room.price_weekend) : Number(room.price_weekday);
}

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const {
      room_id: roomId,
      customer_name: customerName,
      phone,
      email,
      start_date: startDate,
      start_time: startTime,
      duration_hours: durationHours,
      repeat_weeks: repeatWeeks,
      guest_count: guestCount,
      notes,
    } = body as {
      room_id: string;
      customer_name: string;
      phone: string;
      email?: string | null;
      start_date: string;
      start_time: string;
      duration_hours: number;
      repeat_weeks: number;
      guest_count?: number | null;
      notes?: string | null;
    };

    if (!roomId || !customerName?.trim() || !phone?.trim() || !startDate || !startTime) {
      return NextResponse.json(
        { error: "缺少必填欄位（包廂、姓名、電話、起始日期、開始時間）" },
        { status: 400 }
      );
    }
    const weeks = Number(repeatWeeks);
    const duration = Number(durationHours);
    if (!Number.isFinite(weeks) || weeks < 4 || weeks > 12) {
      return NextResponse.json(
        { error: "重複週數須為 4–12" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(duration) || duration <= 0 || duration > 8) {
      return NextResponse.json(
        { error: "時數須為 1–8 小時" },
        { status: 400 }
      );
    }

    const room = await fetchRoom(roomId);
    if (!room) {
      return NextResponse.json({ error: "包廂不存在" }, { status: 404 });
    }

    const details: { week: number; date: string; status: "created" | "skipped"; error?: string }[] = [];
    let created = 0;
    let skipped = 0;

    for (let week = 0; week < weeks; week++) {
      const d = new Date(startDate + "T12:00:00");
      d.setDate(d.getDate() + week * 7);
      const dateStr = d.toISOString().slice(0, 10);
      const [h, m] = startTime.split(":").map(Number);
      const start = new Date(`${dateStr}T${String(h ?? 0).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}:00`);
      const end = new Date(start.getTime() + duration * 60 * 60 * 1000);
      const start_time = start.toISOString();
      const end_time = end.toISOString();

      const conflict = await hasSlotConflict(roomId, start_time, end_time);
      if (conflict) {
        skipped++;
        details.push({ week: week + 1, date: dateStr, status: "skipped", error: "該時段已被預訂" });
        continue;
      }

      const pricePerHour = getPriceForDate(room, dateStr);
      const total_price = Math.round(pricePerHour * duration);

      try {
        await insertReservationAdmin({
          room_id: roomId,
          customer_name: customerName.trim(),
          phone: phone.trim(),
          email: email?.trim() || null,
          start_time,
          end_time,
          total_price,
          guest_count: guestCount ?? null,
          notes: notes?.trim() || null,
        });
        created++;
        details.push({ week: week + 1, date: dateStr, status: "created" });
      } catch (e) {
        skipped++;
        details.push({
          week: week + 1,
          date: dateStr,
          status: "skipped",
          error: e instanceof Error ? e.message : "新增失敗",
        });
      }
    }

    return NextResponse.json({ created, skipped, details });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法建立週期預約";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
