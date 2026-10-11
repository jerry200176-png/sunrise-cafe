/**
 * 結構化付款路徑日誌（Vercel logs / Sentry breadcrumbs 友善）
 */

export type PaymentLogAction =
  | "payment_event.created"
  | "payment_event.approved"
  | "payment_event.rejected"
  | "payment_event.duplicate_skipped"
  | "payment_event.insert_failed"
  | "deposit_deadline.cron_run"
  | "deposit_deadline.released"
  | "deposit_deadline.reminded"
  | "deposit_deadline.urgent_reminded"
  | "payment_reconcile.import"
  | "linepay.requested"
  | "linepay.request_failed"
  | "linepay.confirmed"
  | "linepay.confirm_failed"
  | "deposit.marked_paid"
  | "deposit.marked_unpaid"
  | "deposit.note_updated"
  | "deposit.auto_released";

export type DepositAuditActor =
  | "admin_session"
  | "line_webhook_text"
  | "line_webhook_image"
  | "admin_payment_review"
  | "stripe_webhook"
  | "stripe_confirm"
  | "cron_deposit_deadline"
  | "system";

export function logPayment(
  action: PaymentLogAction,
  detail: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      domain: "payment",
      action,
      ...detail,
    })
  );
}

const NOTE_MAX = 200;

function truncateNote(note: string | null | undefined): string | null {
  if (note == null || note === "") return null;
  return note.length <= NOTE_MAX ? note : `${note.slice(0, NOTE_MAX)}…`;
}

type DepositAuditSnapshot = {
  is_deposit_paid?: boolean;
  deposit_payment_note?: string | null;
  deposit_paid_on?: string | null;
  deposit_last_five?: string | null;
  status?: string;
};

/** Phase A audit — deposit state changes (no PII beyond booking_code) */
export function logDepositStatusChange(opts: {
  action: "deposit.marked_paid" | "deposit.marked_unpaid" | "deposit.note_updated" | "deposit.auto_released";
  reservation_id: string;
  booking_code?: string | null;
  actor_type: DepositAuditActor;
  before: DepositAuditSnapshot;
  after: DepositAuditSnapshot;
  payment_event_id?: string;
}): void {
  logPayment(opts.action, {
    reservation_id: opts.reservation_id,
    booking_code: opts.booking_code ?? undefined,
    actor_type: opts.actor_type,
    payment_event_id: opts.payment_event_id,
    before: {
      is_deposit_paid: opts.before.is_deposit_paid,
      deposit_payment_note: truncateNote(opts.before.deposit_payment_note),
      deposit_paid_on: opts.before.deposit_paid_on,
      // 末五碼屬帳號片段，log 只記有無；實際值在 reservations 欄位
      has_last_five: opts.before.deposit_last_five === undefined ? undefined : Boolean(opts.before.deposit_last_five),
      status: opts.before.status,
    },
    after: {
      is_deposit_paid: opts.after.is_deposit_paid,
      deposit_payment_note: truncateNote(opts.after.deposit_payment_note),
      deposit_paid_on: opts.after.deposit_paid_on,
      // 末五碼屬帳號片段，log 只記有無；實際值在 reservations 欄位
      has_last_five: opts.after.deposit_last_five === undefined ? undefined : Boolean(opts.after.deposit_last_five),
      status: opts.after.status,
    },
  });
}
