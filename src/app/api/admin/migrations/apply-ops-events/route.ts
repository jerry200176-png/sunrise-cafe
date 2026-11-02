import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/admin-api-auth";
import { migrationPaused } from "@/lib/migration-pause";

function pgConnectionString(): string | null {
  return (
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    null
  );
}

async function probeTable(): Promise<{ ok: boolean; message?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, message: "Supabase not configured" };

  try {
    const { error } = await createClient(url, key).from("ops_events").select("id").limit(1);
    if (!error) return { ok: true };
  } catch { /* Expose only a fixed status, not upstream connection details. */ }
  return { ok: false, message: "無法確認資料表狀態" };
}

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** GET: check ops_events readiness · POST: authenticated migration pause notice */
export async function GET() {
  const probe = await probeTable();
  return NextResponse.json({
    table_ready: probe.ok,
    message: probe.message ?? (probe.ok ? "OK" : "unknown"),
    postgres_url_configured: Boolean(pgConnectionString()),
  });
}

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    const denied = await requirePermission(request, "bi:read");
    if (denied) return denied;
  }

  return migrationPaused();
}
