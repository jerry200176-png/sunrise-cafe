/**
 * LINE account binding — requires booking_code + phone verification.
 */
import { extractBookingCode } from "@/lib/payment-keywords";
import { normalizePhone, phonesMatch } from "@/lib/phone-utils";

const BIND_STATE_PREFIX = "bind:";

/** Taiwan mobile pattern (09xxxxxxxx or 8869xxxxxxxx). */
const PHONE_IN_TEXT_RE = /(?:886)?0?9\d{8}/;

export type LineBindPayload = {
  bookingCode: string;
  phone?: string;
};

export function extractPhoneFromText(text: string): string | null {
  const match = text.match(PHONE_IN_TEXT_RE);
  if (!match) return null;
  const norm = normalizePhone(match[0]);
  return norm.length >= 10 ? norm : null;
}

/**
 * Parse guest LINE bind message.
 * - "ABC123" only → code without phone (must prompt)
 * - "ABC123 0912345678" → verified bind attempt
 */
export function parseLineBindPayload(text: string): LineBindPayload | null {
  const upper = text.toUpperCase().trim();
  let bookingCode = extractBookingCode(upper);
  if (!bookingCode) {
    const wordMatch = upper.match(/\b([A-Z0-9]{6})\b/);
    bookingCode = wordMatch?.[1] ?? null;
  }
  if (!bookingCode) return null;

  const withoutCode = upper.replace(bookingCode, " ").trim();
  const phone = extractPhoneFromText(withoutCode) ?? undefined;
  return phone ? { bookingCode, phone } : { bookingCode };
}

export function encodeLineBindState(bookingCode: string, phone: string): string {
  const code = bookingCode.trim().toUpperCase();
  const phoneNorm = normalizePhone(phone);
  return `${BIND_STATE_PREFIX}${code}:${phoneNorm}`;
}

export function decodeLineBindState(state: string | null): LineBindPayload | null {
  if (!state?.startsWith(BIND_STATE_PREFIX)) return null;
  const rest = state.slice(BIND_STATE_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const bookingCode = rest.slice(0, sep).trim().toUpperCase();
  const phone = rest.slice(sep + 1).trim();
  if (!/^[A-Z0-9]{6}$/.test(bookingCode) || !phone) return null;
  return { bookingCode, phone: normalizePhone(phone) };
}

export function phonesMatchReservation(storedPhone: string, inputPhone: string): boolean {
  return phonesMatch(storedPhone, inputPhone);
}

export const LINE_BIND_PHONE_PROMPT =
  "為確認身分，請傳送「訂位代號 + 手機號碼」，例如：\nABC123 0912345678";

export const LINE_BIND_PHONE_MISMATCH =
  "手機號碼與訂位資料不符，請確認後再試一次。";
