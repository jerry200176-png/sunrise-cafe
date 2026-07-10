import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import {
  compareSchemaMigrations,
  getExpectedMigrations,
  buildDbHealth,
} from "@/lib/schema-governance";

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

  try {
    const { data: rows, error } = await supabaseAdmin()
      .from("schema_migrations")
      .select("name")
      .order("applied_at", { ascending: true });

    const schemaTableMissing = Boolean(
      error?.message?.includes("schema_migrations") ||
        error?.message?.includes("does not exist")
    );

    const appliedNames = schemaTableMissing
      ? []
      : (rows ?? []).map((r) => r.name as string);

    const drift = compareSchemaMigrations(appliedNames);

    let analyticsCount: number | null = null;
    let reservationsCount: number | null = null;

    const { count: aCount, error: aErr } = await supabaseAdmin()
      .from("analytics_events")
      .select("id", { count: "exact", head: true });
    if (!aErr) analyticsCount = aCount;

    const { count: rCount, error: rErr } = await supabaseAdmin()
      .from("reservations")
      .select("id", { count: "exact", head: true });
    if (!rErr) reservationsCount = rCount;

    const retentionDays = Number(request.nextUrl.searchParams.get("retention_days") ?? "730");

    return NextResponse.json({
      manifest_count: getExpectedMigrations().length,
      schema_migrations_table: !schemaTableMissing,
      drift: drift.drift,
      pending_migrations: drift.pending,
      extra_migrations: drift.extra,
      applied_count: appliedNames.length,
      health: buildDbHealth({
        analytics_events_count: analyticsCount,
        reservations_count: reservationsCount,
        retention_days: retentionDays,
      }),
      docs: {
        evolution: "/docs/DATABASE_EVOLUTION.md",
        migrations: "/docs/MIGRATIONS.md",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Schema 狀態查詢失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
