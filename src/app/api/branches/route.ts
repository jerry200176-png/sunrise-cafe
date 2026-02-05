import { NextRequest, NextResponse } from "next/server";
import { fetchBranches, insertBranch } from "@/lib/supabase-fetch";

export async function GET() {
  try {
    const data = await fetchBranches();
    return NextResponse.json(data ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入分店";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, address, phone, open_time, close_time } = body as {
      name: string;
      address?: string | null;
      phone?: string | null;
      open_time?: string | null;
      close_time?: string | null;
    };
    if (!name?.trim()) {
      return NextResponse.json({ error: "名稱為必填" }, { status: 400 });
    }
    await insertBranch({ name: name.trim(), address: address ?? null, phone: phone ?? null, open_time: open_time ?? null, close_time: close_time ?? null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法新增分店";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
