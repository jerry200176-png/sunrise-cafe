/**
 * Admin session payload — extends signed cookie with RBAC claims.
 */
import type { AdminContext, AdminRole } from "@/lib/rbac";
import { ownerContext, parseRole } from "@/lib/rbac";

export type AdminSessionPayload = {
  iat: number;
  exp: number;
  sub?: string;
  role?: AdminRole;
  branch_ids?: string[] | null;
  legacy?: boolean;
  email?: string;
  display_name?: string;
};

export function payloadToContext(payload: AdminSessionPayload): AdminContext {
  if (payload.role === undefined && !payload.sub) {
    return ownerContext(Boolean(payload.legacy));
  }
  return {
    user_id: payload.sub ?? null,
    role: parseRole(payload.role),
    branch_ids: payload.role === "owner"
      ? payload.branch_ids ?? null
      : payload.branch_ids ?? [],
    legacy: Boolean(payload.legacy),
    email: payload.email,
    display_name: payload.display_name,
  };
}

export function contextToPayload(
  ctx: AdminContext,
  iat: number,
  exp: number
): AdminSessionPayload {
  return {
    iat,
    exp,
    sub: ctx.user_id ?? undefined,
    role: ctx.role,
    branch_ids: ctx.branch_ids,
    legacy: ctx.legacy || undefined,
    email: ctx.email,
    display_name: ctx.display_name,
  };
}
