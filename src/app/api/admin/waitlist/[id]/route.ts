import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { canAccessBranch } from "@/lib/rbac";
import { logOps } from "@/lib/ops-log";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type Params = { params: Promise<{ id: string }> };

/** DELETE: 手動移除等位（標記 expired） */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const denied = await requirePermission(request, "reservations:write");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  const ctx = await getAdminContext(request);

  try {
    const { data: entry, error: fetchErr } = await db()
      .from("waitlist")
      .select("id, status, room:rooms(branch_id)")
      .eq("id", id)
      .single();

    if (fetchErr || !entry) {
      return NextResponse.json({ error: "找不到等位紀錄" }, { status: 404 });
    }

    const room = Array.isArray(entry.room) ? entry.room[0] : entry.room;
    const branchId = (room as { branch_id?: string } | null)?.branch_id;
    if (branchId && !canAccessBranch(ctx, branchId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!["waiting", "notified"].includes(entry.status as string)) {
      return NextResponse.json({ error: "此紀錄已結束，無法移除" }, { status: 409 });
    }

    const { error } = await db()
      .from("waitlist")
      .update({ status: "expired" })
      .eq("id", id);

    if (error) throw error;

    logOps("admin", "admin.waitlist_expired", {
      waitlist_id: id,
      previous_status: entry.status,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "移除失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
