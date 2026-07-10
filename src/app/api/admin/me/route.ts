import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth, getAdminContext } from "@/lib/admin-api-auth";
import { roleHasPermission } from "@/lib/rbac";

export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  const ctx = await getAdminContext(request);
  return NextResponse.json({
    user_id: ctx.user_id,
    role: ctx.role,
    branch_ids: ctx.branch_ids,
    legacy: ctx.legacy,
    email: ctx.email ?? null,
    display_name: ctx.display_name ?? null,
    permissions: {
      users_manage: roleHasPermission(ctx.role, "users:manage"),
      payments_read: roleHasPermission(ctx.role, "payments:read"),
      bi_read: roleHasPermission(ctx.role, "bi:read"),
      branches_write: roleHasPermission(ctx.role, "branches:write"),
    },
  });
}
