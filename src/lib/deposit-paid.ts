/**
 * Deposit paid: the one module that records "this reservation's deposit is
 * paid" and everything that follows (audit log, guest/group approval
 * notification with its retry/lease, the Stripe deposit_status column).
 *
 *   markDepositPaid(reservationId, source, evidence, actor)
 *
 * Every paid path goes through it: admin PATCH, payment review approval
 * (screenshots and bank-transfer reports), Stripe webhook and Stripe
 * confirm-deposit. The deposit_approved_* tracking columns are written only by
 * payment-notify, never by callers. The deposit amount is computed only by
 * `getDepositAmount` (booking-utils).
 */
import { fromStripeAmount } from "@/lib/stripe-money";
import { createClient } from "@supabase/supabase-js";
import { getDepositAmount } from "@/lib/booking-utils";
import { logDepositStatusChange, type DepositAuditActor } from "@/lib/payment-log";
import {
  notifyPaymentApproved,
  type NotifyPaymentApprovedResult,
} from "@/lib/payment-notify";

export type DepositSource =
  | "admin_patch"
  | "payment_review"
  | "stripe_webhook"
  | "stripe_confirm";

export type DepositEvidence = {
  note?: string | null;
  /** Text shown in the approval notification when it differs from the stored note (review notes). */
  reviewNote?: string | null;
  paidOn?: string | null;
  lastFive?: string | null;
  paymentEventId?: string;
};

export type DepositResult = {
  /** false when the reservation was already marked paid */
  changed: boolean;
  notification: NotifyPaymentApprovedResult | null;
};

type DepositRow = {
  is_deposit_paid: boolean;
  deposit_payment_note: string | null;
  deposit_paid_on: string | null;
  deposit_last_five: string | null;
  status: string;
  booking_code: string;
};

/** Seam: persistence, notification and audit. */
export type DepositEffects = {
  load(id: string): Promise<DepositRow | null>;
  write(id: string, patch: Record<string, unknown>): Promise<void>;
  notify: typeof notifyPaymentApproved;
  audit: typeof logDepositStatusChange;
};

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export const supabaseDepositEffects: DepositEffects = {
  async load(id) {
    const { data } = await db()
      .from("reservations")
      .select("is_deposit_paid, deposit_payment_note, deposit_paid_on, deposit_last_five, status, booking_code")
      .eq("id", id)
      .maybeSingle();
    return (data as DepositRow | null) ?? null;
  },
  async write(id, patch) {
    const { error } = await db().from("reservations").update(patch).eq("id", id);
    if (error) throw error;
  },
  notify: notifyPaymentApproved,
  audit: logDepositStatusChange,
};

const AUDIT_ACTOR: Record<DepositSource, DepositAuditActor> = {
  admin_patch: "admin_session",
  payment_review: "admin_payment_review",
  stripe_webhook: "stripe_webhook",
  stripe_confirm: "stripe_confirm",
};

const STRIPE: DepositSource[] = ["stripe_webhook", "stripe_confirm"];

function infoPatch(e: DepositEvidence): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (e.note !== undefined) p.deposit_payment_note = e.note;
  if (e.paidOn !== undefined) p.deposit_paid_on = e.paidOn;
  if (e.lastFive !== undefined) p.deposit_last_five = e.lastFive;
  return p;
}

function snapshot(row: DepositRow, patch: Record<string, unknown>) {
  const pick = <K extends keyof DepositRow>(k: K) => (k in patch ? (patch[k] as DepositRow[K]) : row[k]);
  return {
    is_deposit_paid: pick("is_deposit_paid"),
    deposit_payment_note: pick("deposit_payment_note"),
    deposit_paid_on: pick("deposit_paid_on"),
    deposit_last_five: pick("deposit_last_five"),
    status: row.status,
  };
}

export async function markDepositPaid(
  reservationId: string,
  source: DepositSource,
  evidence: DepositEvidence = {},
  actor: string | null = null,
  fx: DepositEffects = supabaseDepositEffects
): Promise<DepositResult> {
  const before = await fx.load(reservationId);
  if (!before) throw new Error("找不到訂位");

  const patch: Record<string, unknown> = {
    is_deposit_paid: true,
    ...(STRIPE.includes(source) ? { deposit_status: "paid" } : {}),
    ...infoPatch(evidence),
  };
  await fx.write(reservationId, patch);

  const changed = !before.is_deposit_paid;
  if (changed) {
    fx.audit({
      action: "deposit.marked_paid",
      reservation_id: reservationId,
      booking_code: before.booking_code,
      actor_type: AUDIT_ACTOR[source],
      payment_event_id: evidence.paymentEventId,
      before: snapshot(before, {}),
      after: snapshot(before, patch),
    });
  }

  // Notify on every path. notifyPaymentApproved is idempotent (notified_at +
  // claim lease + stable retry keys), so calling it again also retries a
  // notification that previously failed or timed out.
  let notification: NotifyPaymentApprovedResult | null;
  try {
    notification = await fx.notify(reservationId, {
      actor: actor ?? AUDIT_ACTOR[source],
      reviewNote:
        evidence.reviewNote !== undefined ? evidence.reviewNote : evidence.note !== undefined ? evidence.note : before.deposit_payment_note,
      paymentEventId: evidence.paymentEventId,
      manualApproval: source === "admin_patch",
    });
  } catch (err) {
    console.error(`[deposit-paid] notifyPaymentApproved failed (${source}):`, err);
    notification = { ok: false, error: "notification_dispatch_failed" };
  }
  return { changed, notification };
}

/** Admin un-marks a deposit (mistaken approval). Audit only; no guest message. */
export async function markDepositUnpaid(
  reservationId: string,
  evidence: DepositEvidence = {},
  fx: DepositEffects = supabaseDepositEffects
): Promise<{ changed: boolean }> {
  const before = await fx.load(reservationId);
  if (!before) throw new Error("找不到訂位");
  const patch = { is_deposit_paid: false, ...infoPatch(evidence) };
  await fx.write(reservationId, patch);
  const changed = before.is_deposit_paid;
  if (changed) {
    fx.audit({
      action: "deposit.marked_unpaid",
      reservation_id: reservationId,
      booking_code: before.booking_code,
      actor_type: "admin_session",
      before: snapshot(before, {}),
      after: snapshot(before, patch),
    });
  }
  return { changed };
}

/** Admin edits transfer note / date / last five without changing paid state. */
export async function updateDepositInfo(
  reservationId: string,
  evidence: DepositEvidence,
  fx: DepositEffects = supabaseDepositEffects
): Promise<void> {
  const before = await fx.load(reservationId);
  if (!before) throw new Error("找不到訂位");
  const patch = infoPatch(evidence);
  await fx.write(reservationId, patch);
  const after = snapshot(before, patch);
  const same =
    before.deposit_payment_note === after.deposit_payment_note &&
    before.deposit_paid_on === after.deposit_paid_on &&
    before.deposit_last_five === after.deposit_last_five;
  if (!same) {
    fx.audit({
      action: "deposit.note_updated",
      reservation_id: reservationId,
      booking_code: before.booking_code,
      actor_type: "admin_session",
      before: snapshot(before, {}),
      after,
    });
  }
}

/* ------------------------------------------------ Stripe binding check */

export type StripeIntentFacts = {
  id: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string> | null;
};

export type StripeBindingEffects = {
  /** reservation_id recorded for this PaymentIntent by create-intent, if any */
  intentReservationId(piId: string): Promise<string | null>;
  totalPrice(reservationId: string): Promise<number | null>;
};

const supabaseBindingEffects: StripeBindingEffects = {
  async intentReservationId(piId) {
    const { data } = await db().from("payment_intents").select("reservation_id").eq("stripe_pi_id", piId).maybeSingle();
    return (data?.reservation_id as string | undefined) ?? null;
  },
  async totalPrice(id) {
    const { data } = await db().from("reservations").select("total_price").eq("id", id).maybeSingle();
    return data?.total_price == null ? null : Number(data.total_price);
  },
};

/**
 * A succeeded PaymentIntent may mark a reservation paid only if it was created
 * for that reservation and covers its deposit. Without this, any succeeded PI
 * could be replayed against someone else's reservation.
 */
export async function verifyStripeIntentForReservation(
  pi: StripeIntentFacts,
  reservationId: string,
  fx: StripeBindingEffects = supabaseBindingEffects
): Promise<{ ok: true } | { ok: false; status: 403 | 409; error: string }> {
  const bound = await fx.intentReservationId(pi.id);
  if (pi.metadata?.reservationId !== reservationId || (bound !== null && bound !== reservationId)) {
    return { ok: false, status: 403, error: "付款與此預約不符" };
  }
  const total = await fx.totalPrice(reservationId);
  const required = total == null ? 0 : getDepositAmount(total);
  // pi.amount 是 Stripe 單位（TWD ×100），換回整數元再和訂金比
  if (pi.currency.toLowerCase() !== "twd" || !(pi.amount > 0) || fromStripeAmount(pi.amount, pi.currency) < required) {
    return { ok: false, status: 409, error: "付款金額不足" };
  }
  return { ok: true };
}
