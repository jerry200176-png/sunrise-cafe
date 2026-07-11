/**
 * Parse payment_events.raw_payload — text or LINE image metadata JSON.
 */

export type LineImagePayload = {
  kind: "line_image";
  line_message_id: string;
};

export function buildLineImagePayload(messageId: string): string {
  return JSON.stringify({ kind: "line_image", line_message_id: messageId } satisfies LineImagePayload);
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
