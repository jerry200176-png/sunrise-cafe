import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminConfigured } from "@/lib/supabase-admin";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ✅ 修正：定義完整型別
type NewReservation = {
  room_id: string;
  customer_name: string;
  phone: string;
  email: string | null;
  start_time: string;
  end_time: string;
  status: string;
  total_price: number | null;
  guest_count: number | null;
  notes: string | null;
  booking_code: string;
};

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "Server misconfigured (missing service role key)" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const {
      room_id,
      customer_name,
      phone,
      email,
      start_date, 
      end_date,   
      weekdays,   
      start_time, 
      duration_hours,
      guest_count,
      notes,
    } = body;

    if (!room_id || !start_date || !end_date || !weekdays || !start_time || !duration_hours) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 1. 計算所有符合星期的日期
    const candidates: { start: string; end: string }[] = [];
    
    // ✅ 修正：使用 const，並明確建立 Date 物件
    const current = new Date(start_date);
    const end = new Date(end_date);
    
    // 設定到中午避免時區問題
    current.setHours(12, 0, 0, 0);
    end.setHours(12, 0, 0, 0);

    const [sh, sm] = String(start_time).split(":").map(Number);

    while (current <= end) {
      const day = current.getDay();
      if (weekdays.includes(day)) {
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, "0");
        const d = String(current.getDate()).padStart(2, "0");
        const dateStr = `${y}-${m}-${d}`;

        const startDt = new Date(`${dateStr}T${String(sh).padStart(2,"0")}:${String(sm).padStart(2,"0")}:00+08:00`);
        const endDt = new Date(startDt.getTime() + Number(duration_hours) * 60 * 60 * 1000);
        
        candidates.push({
          start: startDt.toISOString(),
          end: endDt.toISOString(),
        });
      }
      current.setDate(current.getDate() + 1);
    }

    if (candidates.length === 0) {
      return NextResponse.json({ error: "No dates match the selected weekdays" }, { status: 400 });
    }

    // 2. 檢查衝突
    const minStart = candidates[0].start;
    const maxEnd = candidates[candidates.length - 1].end;

    const { data: existingRaw, error: fetchError } = await supabaseAdmin
      .from("reservations")
      .select("start_time, end_time")
      .eq("room_id", room_id)
      .eq("status", "confirmed")
      .gte("end_time", minStart)
      .lte("start_time", maxEnd);

    if (fetchError) throw fetchError;

    // ✅ 修正：明確轉型，移除 implicit any
    const existing = (existingRaw ?? []) as { start_time: string; end_time: string }[];

    const conflicts: string[] = [];
    const validReservations: NewReservation[] = [];

    for (const c of candidates) {
      const isConflict = existing.some((e) => {
        return c.start < e.end_time && c.end > e.start_time;
      });

      if (isConflict) {
        conflicts.push(c.start.slice(0, 10));
      } else {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        validReservations.push({
          room_id,
          customer_name,
          phone,
          email: email || null,
          start_time: c.start,
          end_time: c.end,
          status: "confirmed",
          total_price: null,
          guest_count: guest_count || null,
          notes: notes || null,
          booking_code: code,
        });
      }
    }

    if (conflicts.length > 0) {
      return NextResponse.json(
        { 
          error: "部分時段已有預約，操作取消", 
          conflicts 
        }, 
        { status: 409 }
      );
    }

    // 3. 批次寫入
    const { error: insertError } = await supabaseAdmin
      .from("reservations")
      .insert(validReservations);

    if (insertError) throw insertError;

    return NextResponse.json({ 
      success: true, 
      created: validReservations.length 
    });

  } catch (error: unknown) {
    // ✅ 修正：使用 type narrowing 處理 unknown error
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}