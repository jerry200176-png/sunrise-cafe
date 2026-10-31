import { NextRequest, NextResponse } from "next/server";
import { fetchSettings, updateSettings } from "@/lib/supabase-fetch";
import { requirePermission, hasValidAdminSession } from "@/lib/admin-api-auth";

export async function GET(request: NextRequest) {
  try {
    const data = await fetchSettings();
    const isAdmin = await hasValidAdminSession(request);
    if (!isAdmin) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip from public response
      const { payment_keywords, ...publicData } = data;
      return NextResponse.json(publicData);
    }
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入設定";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await requirePermission(request, "settings:write");
  if (denied) return denied;

  try {
    const body = await request.json();
    const { current_branch_id, rental_notes, closed_dates, deposit_info, payment_keywords, google_review_url } = body as {
      current_branch_id?: string | null;
      rental_notes?: import("@/types").RentalNoteSection[];
      closed_dates?: string[];
      deposit_info?: string | null;
      payment_keywords?: string[];
      google_review_url?: string | null;
    };
    await updateSettings(current_branch_id, rental_notes, closed_dates, deposit_info, payment_keywords, google_review_url);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法更新設定";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
