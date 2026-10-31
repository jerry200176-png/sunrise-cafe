import type { AdminContext } from "@/lib/rbac";
import { fetchReservationBranchId, supabaseAdmin } from "@/lib/supabase-admin";

/** Check event ownership before exposing or modifying it. Only an owner can have unrestricted scope. */
export async function paymentEventInScope(eventId: string, context: AdminContext): Promise<boolean> {
  if (context.branch_ids === null) return context.role === "owner";
  if (!context.branch_ids?.length) return false;
  const { data, error } = await supabaseAdmin().from("payment_events")
    .select("reservation_id").eq("id", eventId).maybeSingle();
  if (error) throw new Error("付款資料暫時無法讀取");
  if (!data || typeof data.reservation_id !== "string") return false;
  const branchId = await fetchReservationBranchId(data.reservation_id);
  return Boolean(branchId && context.branch_ids.includes(branchId));
}
