import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { probeOpsEvents } from "@/lib/ops-events-readiness.mjs";

async function ready() {
  return probeOpsEvents({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    allowedOrigin: process.env.OPS_EVENTS_DIAGNOSTIC_ALLOWED_ORIGIN,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

/** Diagnostic REST projection only; it cannot establish migration readiness. */
export async function GET() {
  const projectionVisible = await ready();
  const postgresUrlConfigured = Boolean(process.env.SUPABASE_DB_URL ?? process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ?? process.env.DATABASE_URL);
  return NextResponse.json({ table_ready: false, rest_projection_visible: projectionVisible,
    message: "Migration readiness unverified",
    postgres_url_configured: postgresUrlConfigured });
}

/** Authorized historical caller: never executes SQL, even if the table is missing. */
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    const denied = await requirePermission(request, "bi:read");
    if (denied) return denied;
  }
  return NextResponse.json({ error: "ops_events migration readiness unverified; no migration was run" }, { status: 503 });
}
