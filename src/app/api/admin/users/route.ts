import { NextRequest, NextResponse } from "next/server";
import {
  createAdminUser,
  isAdminUsersTableReady,
  listAdminUsers,
  writePermissionAudit,
} from "@/lib/admin-users";
import { requirePermission, getAdminContext } from "@/lib/admin-api-auth";
import { ADMIN_ROLES, type AdminRole } from "@/lib/rbac";
import { isAdminConfigured } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "users:manage");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  if (!(await isAdminUsersTableReady())) {
    return NextResponse.json({ users: [], migration_required: true });
  }

  try {
    const users = await listAdminUsers();
    return NextResponse.json({ users });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入使用者";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requirePermission(request, "users:manage");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  if (!(await isAdminUsersTableReady())) {
    return NextResponse.json(
      { error: "請先執行 migration-phase7-rbac.sql", migration_required: true },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const display_name = String(body.display_name ?? "").trim();
    const role = String(body.role ?? "") as AdminRole;
    const branch_ids = Array.isArray(body.branch_ids)
      ? body.branch_ids.map(String)
      : [];

    if (!email || !password || password.length < 8) {
      return NextResponse.json(
        { error: "email 與 password（至少 8 字）為必填" },
        { status: 400 }
      );
    }
    if (!ADMIN_ROLES.includes(role)) {
      return NextResponse.json({ error: "無效的角色" }, { status: 400 });
    }
    if (role !== "owner" && branch_ids.length === 0) {
      return NextResponse.json(
        { error: "非 owner 角色須指定至少一個分店" },
        { status: 400 }
      );
    }

    const ctx = await getAdminContext(request);
    const { id } = await createAdminUser({
      email,
      password,
      display_name: display_name || email,
      role,
      branch_ids,
    });

    await writePermissionAudit({
      actor_user_id: ctx.user_id,
      target_user_id: id,
      action: "user_created",
      after_state: { email, role, branch_ids },
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法建立使用者";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
