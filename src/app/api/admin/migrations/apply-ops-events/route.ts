import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { probeOpsEvents } from "@/lib/ops-events-readiness.mjs";

async function ready() {
  return probeOpsEvents({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

/** Read-only compatibility endpoint; REST visibility is not a full schema audit. */
export async function GET() {
  const tableReady = await ready();
  const postgresUrlConfigured = Boolean(process.env.SUPABASE_DB_URL ?? process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ?? process.env.DATABASE_URL);
  return NextResponse.json({ table_ready: tableReady, message: tableReady ? "OK" : "Readiness unavailable",
    postgres_url_configured: postgresUrlConfigured });
}

/** Authorized historical caller: never executes SQL, even if the table is missing. */
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    const denied = await requirePermission(request, "bi:read");
    if (denied) return denied;
  }
  if (await ready()) return NextResponse.json({ ok: true, already_applied: true, message: "ops_events is REST-visible" });
  return NextResponse.json({ error: "ops_events readiness unavailable; no migration was run" }, { status: 503 });
}
