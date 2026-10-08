/**
 * deliverOnce: send one LINE message at most once per
 * (kind, reservation, recipient, eventKey), backed by the single
 * `line_deliveries` table (claim_line_delivery RPC).
 *
 * - The claim is durable and taken BEFORE the push. A claim left in `sending`
 *   (crash) or `sent` is never re-sent automatically; only a `failed` claim can
 *   be re-claimed. Favours at-most-once over a duplicate push.
 * - `send` failing marks the claim failed and returns "error" (never throws).
 * - Callers pick the recipient; this module does not verify it belongs to the
 *   reservation.
 * - Missing ledger: compatibility mode ("sent" without a claim is NOT assumed;
 *   the send is skipped) outside production, hard error in production.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type DeliverOnceResult = "sent" | "skipped" | "error";

function ledgerUnavailable(error: { message?: string; code?: string } | null): boolean {
  return Boolean(
    error &&
      (error.code === "PGRST202" ||
        error.code === "PGRST205" ||
        /line_deliveries|claim_line_delivery/i.test(error.message ?? ""))
  );
}

async function mark(
  client: SupabaseClient,
  id: string,
  result: { status: "sent" | "failed"; error?: string }
) {
  try {
    const { error } = await client
      .from("line_deliveries")
      .update({
        status: result.status,
        sent_at: result.status === "sent" ? new Date().toISOString() : null,
        last_error: result.error ?? null,
      })
      .eq("id", id);
    if (error) throw error;
  } catch (err) {
    console.warn("[deliver-once] state update failed:", err instanceof Error ? err.message : String(err));
  }
}

export async function deliverOnce(
  kind: string,
  reservationId: string,
  recipient: string,
  send: () => Promise<void>,
  opts: { eventKey?: string; client?: SupabaseClient } = {}
): Promise<DeliverOnceResult> {
  const client = opts.client ?? supabaseAdmin();
  const { data, error } = await client
    .rpc("claim_line_delivery", {
      p_kind: kind,
      p_reservation_id: reservationId,
      p_recipient_id: recipient,
      p_event_key: opts.eventKey ?? "default",
    })
    .maybeSingle();

  if (error) {
    if (ledgerUnavailable(error)) {
      if (process.env.VERCEL_ENV === "production") {
        throw new Error("LINE delivery ledger unavailable in production");
      }
      return "skipped";
    }
    throw error;
  }
  const id = (data as { delivery_id?: string } | null)?.delivery_id ?? null;
  if (!id) return "skipped"; // another process owns it, or it was already delivered

  try {
    await send();
  } catch (err) {
    await mark(client, id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
    console.error(`[deliver-once] ${kind} push failed:`, err instanceof Error ? err.message : String(err));
    return "error";
  }
  await mark(client, id, { status: "sent" });
  return "sent";
}
