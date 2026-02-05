import { NextRequest, NextResponse } from "next/server";
import { fetchSettings, updateSettings } from "@/lib/supabase-fetch";

export async function GET() {
  try {
    const data = await fetchSettings();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入設定";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { current_branch_id } = body as { current_branch_id?: string | null };
    await updateSettings(current_branch_id ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法更新設定";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
