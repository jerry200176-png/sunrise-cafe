/**
 * PII-free reminder run evidence contract (Phase 1).
 * Delivery certainty: LINE Messaging API has no end-user receipt → delivery_unknown.
 */
export type LineDeliveryCertainty =
  | "accepted_by_line"
  | "rejected_by_line"
  | "delivery_unknown"
  | "not_attempted";

export type ReminderRunEvidence = {
  run_id: string;
  scheduled_for: string;
  invoked_at: string;
  source: "vercel_cron" | "github_backup" | "manual";
  candidate_reservation_count: number;
  recipient_count: number;
  message_attempt_count: number;
  accepted_count: number;
  rejected_count: number;
  unknown_delivery_count: number;
  duplicate_suppressed_count: number;
  status:
    | "succeeded"
    | "succeeded_with_zero_work"
    | "partial"
    | "failed"
    | "duplicate_skip"
    | "skipped_by_policy";
  application_sha: string | null;
  error_class: string | null;
  safe_error_summary: string | null;
  /** Honest: never "delivered" — only acceptance class */
  delivery_certainty: LineDeliveryCertainty;
};

export function mapTriggerToSource(
  trigger: "cron" | "manual" | "github" | undefined
): ReminderRunEvidence["source"] {
  if (trigger === "github") return "github_backup";
  if (trigger === "manual") return "manual";
  return "vercel_cron";
}

export function buildReminderRunEvidence(input: {
  run_id?: string;
  scheduled_for?: string;
  invoked_at: string;
  source: ReminderRunEvidence["source"];
  candidate_reservation_count: number;
  recipient_count: number;
  message_attempt_count: number;
  accepted_count: number;
  rejected_count: number;
  /** Requests whose provider response could not establish acceptance. */
  unknown_attempt_count?: number;
  duplicate_suppressed_count?: number;
  result:
    | "sent"
    | "already_notified"
    | "empty_cat"
    | "duplicate_skip"
    | "schedule_window_skip"
    | "error"
    | "partial";
  application_sha?: string | null;
  error?: string | null;
}): ReminderRunEvidence {
  const duplicate = input.duplicate_suppressed_count ?? 0;
  let status: ReminderRunEvidence["status"];
  if (input.result === "duplicate_skip") status = "duplicate_skip";
  else if (input.result === "schedule_window_skip") status = "skipped_by_policy";
  else if (input.result === "error") status = "failed";
  else if (input.result === "partial" || (input.accepted_count > 0 && input.rejected_count > 0))
    status = "partial";
  else if (input.result === "empty_cat" || input.candidate_reservation_count === 0)
    status = "succeeded_with_zero_work";
  else if (input.result === "already_notified" && input.message_attempt_count === 0)
    status = "succeeded_with_zero_work";
  else status = "succeeded";

  const unknown = input.accepted_count + (input.unknown_attempt_count ?? 0); // accepted ≠ delivered

  return {
    run_id: input.run_id ?? `local-${input.invoked_at}`,
    scheduled_for: input.scheduled_for ?? input.invoked_at,
    invoked_at: input.invoked_at,
    source: input.source,
    candidate_reservation_count: input.candidate_reservation_count,
    recipient_count: input.recipient_count,
    message_attempt_count: input.message_attempt_count,
    accepted_count: input.accepted_count,
    rejected_count: input.rejected_count,
    unknown_delivery_count: unknown,
    duplicate_suppressed_count: duplicate,
    status,
    application_sha: input.application_sha ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    error_class: input.error ? "line_or_runtime" : null,
    safe_error_summary: input.error
      ? input.error.replace(/U[0-9a-f]{32}/gi, "[redacted_line_user]").slice(0, 200)
      : null,
    delivery_certainty:
      unknown > 0
        ? "delivery_unknown"
        : input.rejected_count > 0
          ? "rejected_by_line"
          : "not_attempted",
  };
}

/** Opaque recipient id — never store raw LINE user id in evidence. */
export function opaqueRecipientId(raw: string): string {
  // Simple non-crypto opaque token for evidence (not a security boundary).
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return `rcp_${h.toString(16)}`;
}
