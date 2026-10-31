/**
 * RBAC — roles, permissions, branch scope checks.
 */
export type AdminRole = "owner" | "branch_manager" | "staff" | "finance" | "none";

export type AdminContext = {
  user_id: string | null;
  role: AdminRole;
  branch_ids: string[] | null;
  legacy: boolean;
  display_name?: string;
  email?: string;
};

/** Assignable roles in admin UI — excludes internal `none`. */
export const ADMIN_ROLES: AdminRole[] = [
  "owner",
  "branch_manager",
  "staff",
  "finance",
];

const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  owner: ["*"],
  branch_manager: [
    "reservations:read",
    "reservations:write",
    "reservations:message_send",
    "reservations:cancel",
    "branches:read",
    "rooms:read",
    "bi:read",
    "ops:read",
    "customers:read",
    "campaigns:read",
    "campaigns:write",
    "orders:read",
    "orders:write",
  ],
  staff: [
    "reservations:read",
    "reservations:write_status",
    "reservations:message_send",
    "ops:read",
    "orders:read",
    "orders:write",
  ],
  finance: ["payments:read", "payments:approve", "bi:read"],
  /** Unauthenticated / invalid session — zero privileges */
  none: [],
};

export function roleHasPermission(role: AdminRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  if (perms.includes("*")) return true;
  return perms.includes(permission);
}

export function canAccessBranch(ctx: AdminContext, branchId: string | null | undefined): boolean {
  if (!branchId) return ctx.role === "owner";
  if (ctx.branch_ids === null) return ctx.role === "owner";
  return ctx.branch_ids.includes(branchId);
}

export function hasPermission(
  ctx: AdminContext,
  permission: string,
  branchId?: string | null
): boolean {
  if (!roleHasPermission(ctx.role, permission)) return false;
  if (branchId && !canAccessBranch(ctx, branchId)) {
    return false;
  }
  return true;
}

export function filterBranchIds(
  ctx: AdminContext,
  allBranchIds: string[]
): string[] {
  if (ctx.branch_ids === null) return ctx.role === "owner" ? allBranchIds : [];
  return allBranchIds.filter((id) => ctx.branch_ids!.includes(id));
}

/**
 * 讀取報表類資料時的分店範圍。
 * 指定分店：只能是自己有權限的（否則 ok:false → 403）。
 * 沒指定（「全部分店」）：只含自己有權限的分店；null 代表不受限（老闆／共用帳號）。
 */
export function resolveBranchScope(
  ctx: AdminContext,
  requested: string | null | undefined
): { ok: true; scope: string[] | null } | { ok: false } {
  if (requested) {
    return canAccessBranch(ctx, requested) ? { ok: true, scope: [requested] } : { ok: false };
  }
  return { ok: true, scope: ctx.branch_ids === null ? (ctx.role === "owner" ? null : []) : [...ctx.branch_ids] };
}

export function ownerContext(legacy = false): AdminContext {
  return {
    user_id: null,
    role: "owner",
    branch_ids: null,
    legacy,
  };
}

/** No privileges — used when admin auth is required but session is missing/invalid. */
export function deniedContext(): AdminContext {
  return {
    user_id: null,
    role: "none",
    branch_ids: [],
    legacy: false,
  };
}

export function parseRole(value: unknown): AdminRole {
  if (
    value === "owner" ||
    value === "branch_manager" ||
    value === "staff" ||
    value === "finance"
  ) {
    return value;
  }
  return "none";
}
