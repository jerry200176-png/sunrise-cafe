import { describe, expect, it } from "vitest";
import {
  buildReminderRunEvidence,
  opaqueRecipientId,
} from "./reminder-run-evidence";

describe("reminder-run-evidence", () => {
  it("marks empty booking day as succeeded_with_zero_work", () => {
    const e = buildReminderRunEvidence({
      invoked_at: "2026-07-19T12:00:00.000Z",
      source: "vercel_cron",
      candidate_reservation_count: 0,
      recipient_count: 0,
      message_attempt_count: 1,
      accepted_count: 1,
      rejected_count: 0,
      result: "empty_cat",
    });
    expect(e.status).toBe("succeeded_with_zero_work");
    expect(e.delivery_certainty).toBe("delivery_unknown");
  });

  it("never claims delivered — accepted means delivery_unknown", () => {
    const e = buildReminderRunEvidence({
      invoked_at: "2026-07-19T12:00:00.000Z",
      source: "vercel_cron",
      candidate_reservation_count: 3,
      recipient_count: 2,
      message_attempt_count: 2,
      accepted_count: 2,
      rejected_count: 0,
      result: "sent",
    });
    expect(e.status).toBe("succeeded");
    expect(e.delivery_certainty).toBe("delivery_unknown");
    expect(e.unknown_delivery_count).toBe(2);
  });

  it("classifies LINE rejection as failed/partial", () => {
    const e = buildReminderRunEvidence({
      invoked_at: "2026-07-19T12:00:00.000Z",
      source: "manual",
      candidate_reservation_count: 2,
      recipient_count: 2,
      message_attempt_count: 2,
      accepted_count: 1,
      rejected_count: 1,
      result: "partial",
    });
    expect(e.status).toBe("partial");
  });

  it("duplicate suppress does not look like zero-booking success", () => {
    const e = buildReminderRunEvidence({
      invoked_at: "2026-07-19T12:00:00.000Z",
      source: "github_backup",
      candidate_reservation_count: 0,
      recipient_count: 0,
      message_attempt_count: 0,
      accepted_count: 0,
      rejected_count: 0,
      duplicate_suppressed_count: 1,
      result: "duplicate_skip",
    });
    expect(e.status).toBe("duplicate_skip");
    expect(e.duplicate_suppressed_count).toBe(1);
  });

  it("classifies an out-of-window scheduled run as policy skipped", () => {
    const e = buildReminderRunEvidence({
      invoked_at: "2026-09-04T16:52:31.938Z",
      source: "github_backup",
      candidate_reservation_count: 0,
      recipient_count: 0,
      message_attempt_count: 0,
      accepted_count: 0,
      rejected_count: 0,
      result: "schedule_window_skip",
    });
    expect(e.status).toBe("skipped_by_policy");
    expect(e.delivery_certainty).toBe("not_attempted");
  });

  it("opaques recipient ids and redacts LINE user-looking tokens in errors", () => {
    expect(opaqueRecipientId("U" + "a".repeat(32)).startsWith("rcp_")).toBe(true);
    const e = buildReminderRunEvidence({
      invoked_at: "2026-07-19T12:00:00.000Z",
      source: "manual",
      candidate_reservation_count: 0,
      recipient_count: 0,
      message_attempt_count: 1,
      accepted_count: 0,
      rejected_count: 1,
      result: "error",
      error: "push failed for Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(e.safe_error_summary).not.toMatch(/Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
    expect(e.safe_error_summary).toContain("[redacted_line_user]");
  });
});
