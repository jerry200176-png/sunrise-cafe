import { NextRequest, NextResponse } from "next/server";
import { requirePermission, getAdminContext } from "@/lib/admin-api-auth";
import { buildMorningSummaryContext, todayTaipeiDateString } from "@/lib/morning-summary-context";
import { buildOperationalRecommendations } from "@/lib/operational-recommendations";
import { findInactiveCustomers } from "@/lib/customer-retention";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "ops:read");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  await getAdminContext(request);

  try {
    const date = request.nextUrl.searchParams.get("date") || todayTaipeiDateString();
    const morning = await buildMorningSummaryContext(date);

    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const { data: resRows } = await supabaseAdmin()
      .from("reservations")
      .select("id, phone, customer_name, status, start_time, created_at, line_user_id")
      .gte("created_at", since);

    const inactive = findInactiveCustomers(resRows ?? [], 90);

    const cancellationSpike = morning.exceptions.some(
      (e) => e.code === "unusual_cancellations"
    );

    const occupancy =
      morning.exceptions.find((e) => e.code === "low_occupancy") != null
        ? 0.1
        : 0.25;

    const recommendations = buildOperationalRecommendations({
      occupancy_rate_7d: occupancy,
      pending_deposit: morning.today.pending_deposit,
      inactive_customers: inactive.length,
      cancellation_spike: cancellationSpike,
    });

    return NextResponse.json({
      date,
      recommendations,
      loop: {
        insight: "ops_exceptions + retention",
        action: "POST /api/admin/business-actions",
        measure: "target_metric / revenue_impact on completion",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "建議載入失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
