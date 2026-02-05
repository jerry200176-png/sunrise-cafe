import { NextRequest, NextResponse } from "next/server";
import { updateReservationAdmin, isAdminConfigured } from "@/lib/supabase-admin";

/** PATCH: 標記該筆訂位已發送明日提醒（is_notified = true） */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }
  try {
    await updateReservationAdmin(id, { is_notified: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法更新";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
