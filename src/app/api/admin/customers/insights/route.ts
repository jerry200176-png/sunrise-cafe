import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { computeCustomerReturnMetrics } from "@/lib/business-kpis";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Mask phone for admin display: 0912***678 */
function maskPhone(phone: string): string {
  const p = phone.trim();
  if (p.length < 6) return "***";
  return `${p.slice(0, 4)}***${p.slice(-3)}`;
}

/**
 * Admin-only customer lifecycle aggregates.
 * Does NOT export full phone list — segments and masked samples only.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const days = Math.min(365, Math.max(30, Number(request.nextUrl.searchParams.get("days") ?? "180")));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await supabaseAdmin()
      .from("reservations")
      .select("phone, status, start_time, line_user_id, review_invited_at, created_at")
      .gte("created_at", since)
      .neq("status", "cancelled");

    if (error) throw error;

    const rows = data ?? [];
    const phones = rows.map((r) => r.phone as string);
    const metrics = computeCustomerReturnMetrics(phones);

    const phoneCounts = new Map<string, number>();
    const phoneLine = new Map<string, boolean>();
    for (const r of rows) {
      const phone = (r.phone as string)?.trim();
      if (!phone) continue;
      phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1);
      if (r.line_user_id) phoneLine.set(phone, true);
    }

    const segments = {
      new_customers: [...phoneCounts.values()].filter((c) => c === 1).length,
      returning_customers: [...phoneCounts.values()].filter((c) => c >= 2 && c < 4).length,
      loyal_customers: [...phoneCounts.values()].filter((c) => c >= 4).length,
    };

    const lineBoundRate =
      phoneCounts.size > 0
        ? [...phoneCounts.keys()].filter((p) => phoneLine.get(p)).length / phoneCounts.size
        : null;

    const reviewInvited = rows.filter((r) => r.review_invited_at).length;
    const reviewInviteRate = rows.length > 0 ? reviewInvited / rows.length : null;

    // Top 5 loyal guests — masked phones only, no names
    const loyalSamples = [...phoneCounts.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([phone, bookings]) => ({
        phone_masked: maskPhone(phone),
        bookings,
        line_bound: phoneLine.get(phone) ?? false,
      }));

    return NextResponse.json({
      days,
      privacy_note:
        "僅回傳聚合指標與遮罩電話樣本；完整客戶名單請由訂位管理查詢。",
      metrics: {
        ...metrics,
        ...segments,
        line_binding_rate: lineBoundRate,
        review_invite_rate: reviewInviteRate,
      },
      loyal_samples: loyalSamples,
      automation: {
        deposit_reminder_cron: "/api/admin/reminders/deposit-deadline",
        tomorrow_reminder_cron: "/api/admin/reminders/send-line",
        seven_day_reminder_cron: "/api/admin/reminders/send-line-7d",
        waitlist_on_cancel: "notifyWaitlist() on cancel/reschedule/deposit-release",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "客戶洞察查詢失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
