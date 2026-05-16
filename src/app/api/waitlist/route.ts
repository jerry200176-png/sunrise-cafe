import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST: 加入等位清單
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { room_id, start_time, end_time, customer_name, phone } = body as {
      room_id: string;
      start_time: string;
      end_time: string;
      customer_name: string;
      phone: string;
    };

    if (!room_id || !start_time || !end_time || !customer_name || !phone) {
      return NextResponse.json({ error: "缺少必要欄位" }, { status: 400 });
    }

    // 防止重複等位（同電話、同包廂、同時段）
    const { data: existing } = await supabaseAdmin()
      .from("waitlist")
      .select("id")
      .eq("room_id", room_id)
      .eq("phone", phone.trim())
      .lt("start_time", end_time)
      .gt("end_time", start_time)
      .eq("status", "waiting")
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: "您已在此時段的等位清單中" }, { status: 409 });
    }

    const { error } = await supabaseAdmin()
      .from("waitlist")
      .insert({
        room_id,
        start_time,
        end_time,
        customer_name: customer_name.trim(),
        phone: phone.trim(),
      });

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法加入等位";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: 查詢等位狀態（by phone）
export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "請提供電話" }, { status: 400 });

  const { data, error } = await supabaseAdmin()
    .from("waitlist")
    .select("id, start_time, end_time, status, created_at, room:rooms(name, branch:branches(name))")
    .eq("phone", phone.trim())
    .eq("status", "waiting")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
