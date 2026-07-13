import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";
import { requirePermission } from "@/lib/admin-api-auth";

const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "supabase/migration-ops-events.sql"),
  "utf8"
);

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

  const { error } = await createClient(url, key).from("ops_events").select("id").limit(1);
  if (!error) return { ok: true };
  const msg = error.message ?? String(error);
  if (/ops_events/i.test(msg) || /PGRST205/i.test(msg)) return { ok: false, message: msg };
  return { ok: false, message: msg };
}

async function applyViaPostgres(): Promise<void> {
  const conn = pgConnectionString();
  if (!conn) {
    throw new Error(
      "No Postgres URL. Set SUPABASE_DB_URL or POSTGRES_URL_NON_POOLING on Vercel."
    );
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(conn, { max: 1, idle_timeout: 10 });
  try {
    await sql.unsafe(MIGRATION_SQL);
  } finally {
    await sql.end({ timeout: 10 });
  }
}

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** GET: check ops_events readiness · POST: apply migration (bi:read or CRON_SECRET) */
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

  const before = await probeTable();
  if (before.ok) {
    return NextResponse.json({ ok: true, already_applied: true, message: "ops_events already exists" });
  }

  try {
    await applyViaPostgres();
    const after = await probeTable();
    if (!after.ok) {
      return NextResponse.json(
        { error: "Migration ran but ops_events still missing", detail: after.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, applied: true, message: "ops_events table created" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
