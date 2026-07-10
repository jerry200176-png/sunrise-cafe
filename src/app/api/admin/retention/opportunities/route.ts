import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import {
  findAnniversaryOpportunities,
  findInactiveCustomers,
  findReviewInviteCandidates,
} from "@/lib/customer-retention";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const days = Math.min(365, Math.max(90, Number(request.nextUrl.searchParams.get("days") ?? "180")));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabaseAdmin()
      .from("reservations")
      .select(
        "id, phone, customer_name, status, start_time, created_at, line_user_id, review_invited_at"
      )
      .gte("created_at", since);

    if (error) throw error;

    const rows = data ?? [];

    return NextResponse.json({
      days,
      privacy_note: "僅供營運參考；名單為遮罩電話或訂位摘要，不含可匯出之完整 PII。",
      inactive_customers: findInactiveCustomers(rows, 90),
      review_invite_candidates: findReviewInviteCandidates(rows).slice(0, 20),
      anniversary_opportunities: findAnniversaryOpportunities(rows, 14),
      counts: {
        inactive: findInactiveCustomers(rows, 90).length,
        review_candidates: findReviewInviteCandidates(rows).length,
        anniversaries: findAnniversaryOpportunities(rows, 14).length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "留存機會查詢失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
