import { NextRequest, NextResponse } from "next/server";
import { fetchRooms, insertRoom } from "@/lib/supabase-fetch";

export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  if (!branchId) {
    return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  }
  try {
    const data = await fetchRooms(branchId);
    return NextResponse.json(data ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入包廂";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { branch_id, name, type, capacity, price_weekday, price_weekend } = body as {
      branch_id: string;
      name: string;
      type?: string | null;
      capacity: number;
      price_weekday: number;
      price_weekend: number;
    };
    if (!branch_id || !name?.trim()) {
      return NextResponse.json({ error: "分店與名稱為必填" }, { status: 400 });
    }
    const cap = Number(capacity);
    const pw = Number(price_weekday);
    const pwe = Number(price_weekend);
    if (Number.isNaN(cap) || cap < 1) {
      return NextResponse.json({ error: "容納人數須為正整數" }, { status: 400 });
    }
    if (Number.isNaN(pw) || pw < 0 || Number.isNaN(pwe) || pwe < 0) {
      return NextResponse.json({ error: "平日/假日每小時價格不可為負" }, { status: 400 });
    }
    await insertRoom({ branch_id, name: name.trim(), type: type ?? null, capacity: cap, price_weekday: pw, price_weekend: pwe });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法新增包廂";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
