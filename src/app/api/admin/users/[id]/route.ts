import { NextRequest, NextResponse } from "next/server";
import {
  listAdminUsers,
  updateAdminUser,
  writePermissionAudit,
} from "@/lib/admin-users";
import { requirePermission, getAdminContext } from "@/lib/admin-api-auth";
import { ADMIN_ROLES, type AdminRole } from "@/lib/rbac";
import { isAdminConfigured } from "@/lib/supabase-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission(request, "users:manage");
  if (denied) return denied;

  const id = (await params).id;
  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const beforeUsers = await listAdminUsers();
    const before = beforeUsers.find((u) => u.id === id);

    const patch: Parameters<typeof updateAdminUser>[1] = {};
    if (body.role !== undefined) {
      const role = String(body.role) as AdminRole;
      if (!ADMIN_ROLES.includes(role)) {
        return NextResponse.json({ error: "無效的角色" }, { status: 400 });
      }
      patch.role = role;
    }
    if (body.display_name !== undefined) patch.display_name = String(body.display_name);
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
    if (body.password) patch.password = String(body.password);
    if (Array.isArray(body.branch_ids)) {
      patch.branch_ids = body.branch_ids.map(String);
    }

    await updateAdminUser(id, patch);

    const ctx = await getAdminContext(request);
    await writePermissionAudit({
      actor_user_id: ctx.user_id,
      target_user_id: id,
      action: "user_updated",
      before_state: before
        ? { role: before.role, branch_ids: before.branch_ids, is_active: before.is_active }
        : null,
      after_state: patch as Record<string, unknown>,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法更新使用者";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
