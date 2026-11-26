/**
 * Parse payment_events.raw_payload — text or LINE image metadata JSON.
 */

import { paymentSourceLabel } from "@/lib/status-labels";

/** Note stored (and shown) for a screenshot payment: same wording as the review queue. */
export const LINE_IMAGE_NOTE = paymentSourceLabel("line_image");

export type LineImagePayload = {
  kind: "line_image";
  line_message_id: string;
};

export function buildLineImagePayload(messageId: string): string {
  return JSON.stringify({ kind: "line_image", line_message_id: messageId } satisfies LineImagePayload);
}

/**
 * Staff-facing text for a stored payment note. Approvals before 2026-11-26 copied the LINE image
 * id JSON into `deposit_payment_note`; show those as the source label instead of raw JSON.
 */
export function paymentNoteLabel(note: string | null | undefined): string | null {
  const text = note?.trim();
  if (!text) return null;
  return parseLineImageMessageId(text) ? LINE_IMAGE_NOTE : text;
}

export function parseLineImageMessageId(rawPayload: string | null): string | null {
  if (!rawPayload?.trim()) return null;
  try {
    const parsed = JSON.parse(rawPayload) as Partial<LineImagePayload>;
    if (parsed.kind === "line_image" && typeof parsed.line_message_id === "string") {
      return parsed.line_message_id;
    }
  } catch {
    // legacy plain-text payload
  }
  return null;
}
