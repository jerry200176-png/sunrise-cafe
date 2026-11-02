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

async function probeColumn(): Promise<{ ok: boolean; message?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, message: "Supabase not configured" };

  try {
    const { error } = await createClient(url, key)
      .from("reservations")
      .select("is_reminded_7d")
      .limit(1);
    if (!error) return { ok: true };
  } catch { /* Expose only a fixed status, not upstream connection details. */ }
  return { ok: false, message: "無法確認欄位狀態" };
}

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * GET: 檢查 is_reminded_7d 欄位是否存在
 * POST: 已授權者可取得暫停執行的提示
 */
export async function GET() {
  const probe = await probeColumn();
  return NextResponse.json({
    column_ready: probe.ok,
    message: probe.message ?? (probe.ok ? "OK" : "unknown"),
    postgres_url_configured: Boolean(pgConnectionString()),
  });
}

export async function POST(request: NextRequest) {
  const cronOk = isCronAuthorized(request);
  if (!cronOk) {
    const denied = await requirePermission(request, "bi:read");
    if (denied) return denied;
  }

  return migrationPaused();
}
