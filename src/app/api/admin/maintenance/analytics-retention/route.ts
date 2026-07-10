import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function verifyCronOrAdmin(request: NextRequest): Promise<NextResponse | null> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return Promise.resolve(null);
  }
  return requireAdminApiAuth(request);
}

export async function GET(request: NextRequest) {
  const denied = await verifyCronOrAdmin(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const retentionDays = Math.min(
    3650,
    Math.max(30, Number(request.nextUrl.searchParams.get("days") ?? "730"))
  );
  const dryRun = request.nextUrl.searchParams.get("dry_run") === "1";

  try {
    if (dryRun) {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin()
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .lt("created_at", cutoff);
      return NextResponse.json({
        ok: true,
        dry_run: true,
        retention_days: retentionDays,
        would_delete: count ?? 0,
      });
    }

    const { data, error } = await supabaseAdmin().rpc("purge_analytics_events_older_than", {
      retention_days: retentionDays,
    });

    if (error) {
      if (error.message.includes("purge_analytics_events")) {
        return NextResponse.json(
          {
            error: "請先執行 migration-phase6-analytics-retention.sql",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      ok: true,
      retention_days: retentionDays,
      deleted: Number(data ?? 0),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analytics 清理失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
