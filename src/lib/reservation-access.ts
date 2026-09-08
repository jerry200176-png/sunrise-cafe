/**
 * Reservation API access rules — RBAC field-level enforcement.
 */
import type { AdminContext } from "@/lib/rbac";
import { hasPermission } from "@/lib/rbac";

const WRITE_FIELDS = new Set([
  "customer_name",
  "phone",
  "email",
  "start_time",
  "end_time",
  "total_price",
  "guest_count",
  "notes",
]);

const DEPOSIT_FIELDS = new Set([
  "is_deposit_paid",
  "deposit_payment_note",
  "deposit_approved_notified_at",
]);

export type ReservationPatch = Record<string, unknown>;

/** @returns error message if denied; null if allowed */
export function assertReservationPatchAllowed(
  ctx: AdminContext,
  patch: ReservationPatch,
  branchId: string
): string | null {
  const keys = Object.keys(patch);
  if (keys.length === 0) return "未提供可更新欄位";

  const depositOnly = keys.every((k) => DEPOSIT_FIELDS.has(k));
  const canRead = hasPermission(ctx, "reservations:read", branchId);
  const canApproveDeposit =
    depositOnly && hasPermission(ctx, "payments:approve", branchId);

  if (!canRead && !canApproveDeposit) {
    return "Forbidden";
  }

  for (const key of keys) {
    if (DEPOSIT_FIELDS.has(key)) {
      const canDeposit =
        hasPermission(ctx, "payments:approve", branchId) ||
        hasPermission(ctx, "reservations:write", branchId);
      if (!canDeposit) return "Forbidden";
      continue;
    }
    if (WRITE_FIELDS.has(key)) {
      if (!hasPermission(ctx, "reservations:write", branchId)) {
        return "Forbidden";
      }
      continue;
    }
    if (key === "status") {
      if (patch.status === "cancelled") {
        if (!hasPermission(ctx, "reservations:cancel", branchId)) {
          return "Forbidden";
        }
      } else if (
        !hasPermission(ctx, "reservations:write", branchId) &&
        !hasPermission(ctx, "reservations:write_status", branchId)
      ) {
        return "Forbidden";
      }
      continue;
    }
    if (!hasPermission(ctx, "reservations:write", branchId)) {
      return "Forbidden";
    }
  }

  return null;
}

export function assertReservationCancelAllowed(
  ctx: AdminContext,
  branchId: string
): string | null {
  if (!hasPermission(ctx, "reservations:cancel", branchId)) {
    return "Forbidden";
  }
  return null;
}

export function assertReservationReadAllowed(
  ctx: AdminContext,
  branchId: string
): string | null {
  if (!hasPermission(ctx, "reservations:read", branchId)) {
    return "Forbidden";
  }
  return null;
}

export function assertReservationWriteAllowed(
  ctx: AdminContext,
  branchId: string
): string | null {
  if (!hasPermission(ctx, "reservations:write", branchId)) {
    return "Forbidden";
  }
  return null;
}

export function assertReservationMessageSendAllowed(
  ctx: AdminContext,
  branchId: string
): string | null {
  if (!hasPermission(ctx, "reservations:message_send", branchId)) {
    return "Forbidden";
  }
  return null;
}
