import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { requirePermission } from "@/lib/admin-api-auth";

const MIGRATION_SQL = readFileSync(
  join(process.cwd(), "supabase/migration-market-parity-rounds-3-7.sql"),
  "utf8"
);

const COLUMNS = [
  { table: "reservations", column: "guest_confirmed_at" },
  { table: "reservations", column: "deposit_urgent_reminder_sent_at" },
  { table: "waitlist", column: "staff_called_at" },
  { table: "waitlist", column: "staff_alerted_at" },
] as const;

function pgConnectionString(): string | null {
  const url =
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    null;
  if (!url || url.includes("[region]") || url.includes("[ref]")) return null;
  return url;
}

async function probeColumn(
  table: string,
  column: string
): Promise<{ exists: boolean; detail?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { exists: false, detail: "Supabase not configured" };

  const res = await fetch(
    `${url.replace(/\/$/, "")}/rest/v1/${table}?select=${column}&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const text = await res.text();
  if (res.status === 200) return { exists: true };
  return { exists: false, detail: text.slice(0, 200) };
}

async function probeAll() {
  const results: Record<string, { exists: boolean; detail?: string }> = {};
  for (const { table, column } of COLUMNS) {
    results[`${table}.${column}`] = await probeColumn(table, column);
  }
  const all = Object.values(results).every((r) => r.exists);
  return { all, results };
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

/** GET: check Round 3–7 columns · POST: apply (admin or CRON_SECRET) */
export async function GET() {
  const probe = await probeAll();
  return NextResponse.json({
    ready: probe.all,
    columns: probe.results,
    postgres_url_configured: Boolean(pgConnectionString()),
  });
}

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    const denied = await requirePermission(request, "bi:read");
    if (denied) return denied;
  }

  const before = await probeAll();
  if (before.all) {
    return NextResponse.json({
      ok: true,
      already_applied: true,
      columns: before.results,
    });
  }

  try {
    await applyViaPostgres();
    const after = await probeAll();
    if (!after.all) {
      return NextResponse.json(
        { error: "Migration ran but columns still missing", columns: after.results },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      applied: true,
      columns: after.results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
