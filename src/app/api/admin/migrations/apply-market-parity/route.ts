import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { migrationPaused } from "@/lib/migration-pause";

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

  try {
    const res = await fetch(
      `${url.replace(/\/$/, "")}/rest/v1/${table}?select=${column}&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (res.status === 200) return { exists: true };
  } catch { /* Expose only a fixed status, not upstream connection details. */ }
  return { exists: false, detail: "無法確認欄位狀態" };
}

async function probeAll() {
  const results: Record<string, { exists: boolean; detail?: string }> = {};
  for (const { table, column } of COLUMNS) {
    results[`${table}.${column}`] = await probeColumn(table, column);
  }
  const all = Object.values(results).every((r) => r.exists);
  return { all, results };
}

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** GET: check Round 3–7 columns · POST: authenticated migration pause notice */
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

  return migrationPaused();
}
