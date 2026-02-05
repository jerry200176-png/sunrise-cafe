import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// 初始化 Supabase Admin Client (因為要寫入 confirmed 訂單)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      room_id,
      customer_name,
      phone,
      email,
      start_date, // YYYY-MM-DD
      end_date,   // YYYY-MM-DD
      weekdays,   // Array<number> [0, 1, ..., 6] (0=Sunday)
      start_time, // HH:mm
      duration_hours,
      guest_count,
      notes,
    } = body;

    if (!room_id || !start_date || !end_date || !weekdays || !start_time || !duration_hours) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 1. 產生所有預約候選時間
    const candidates = [];
    let current = new Date(start_date);
    const end = new Date(end_date);
    // 設定 current 為當天 00:00 以避免時區問題干擾日期迴圈
    current.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
      if (weekdays.includes(current.getDay())) {
        // 組合日期與時間
        const dateStr = current.toISOString().split("T")[0]; // YYYY-MM-DD
        
        // 建立該時段的 ISO String
        const slotStart = new Date(`${dateStr}T${start_time}:00`);
        const slotEnd = new Date(slotStart.getTime() + duration_hours * 60 * 60 * 1000);

        candidates.push({
          dateStr,
          start_time: slotStart.toISOString(),
          end_time: slotEnd.toISOString(),
        });
      }
      // 加一天
      current.setDate(current.getDate() + 1);
    }

    if (candidates.length === 0) {
      return NextResponse.json({ error: "選定的範圍內沒有符合星期幾的日期" }, { status: 400 });
    }

    // 2. 檢查衝突 (一次查出該房間在該大範圍內的所有訂單，再用 JS 比對)
    // 查詢範圍：第一筆候選開始 ~ 最後一筆候選結束
    const rangeStart = candidates[0].start_time;
    const rangeEnd = candidates[candidates.length - 1].end_time;

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("reservations")
      .select("start_time, end_time")
      .eq("room_id", room_id)
      .neq("status", "cancelled")
      .gte("end_time", rangeStart)
      .lte("start_time", rangeEnd);

    if (fetchError) throw fetchError;

    const conflicts: string[] = [];
    const validReservations: any[] = [];

    // 取得房間價格資訊 (用於計算 total_price)
    const { data: roomData } = await supabaseAdmin
      .from("rooms")
      .select("price_weekday, price_weekend")
      .eq("id", room_id)
      .single();
      
    if (!roomData) throw new Error("Room not found");

    for (const cand of candidates) {
      const cStart = new Date(cand.start_time).getTime();
      const cEnd = new Date(cand.end_time).getTime();

      // 檢查是否與現有訂單重疊
      const isConflict = existing?.some((ex) => {
        const eStart = new Date(ex.start_time).getTime();
        const eEnd = new Date(ex.end_time).getTime();
        return cStart < eEnd && cEnd > eStart;
      });

      if (isConflict) {
        conflicts.push(cand.dateStr);
      } else {
        // 計算價格
        const day = new Date(cand.start_time).getDay();
        const isWeekend = day === 0 || day === 6;
        const pricePerHour = isWeekend ? roomData.price_weekend : roomData.price_weekday;
        const total_price = pricePerHour * duration_hours;

        validReservations.push({
          room_id,
          customer_name,
          phone,
          email,
          start_time: cand.start_time,
          end_time: cand.end_time,
          status: "confirmed", // 後台建立預設 confirmed
          total_price,
          guest_count,
          notes,
          is_notified: false,
        });
      }
    }

    // 3. 如果有衝突，回傳錯誤讓前端決定
    if (conflicts.length > 0) {
      return NextResponse.json({ 
        error: "部分日期已有預約", 
        conflicts,
        conflictCount: conflicts.length,
        totalCount: candidates.length
      }, { status: 409 }); // 409 Conflict
    }

    // 4. 無衝突，批次寫入
    if (validReservations.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("reservations")
        .insert(validReservations);

      if (insertError) throw insertError;
    }

    return NextResponse.json({ 
      success: true, 
      created: validReservations.length 
    });

  } catch (error: any) {
    console.error("Admin Recurring Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}