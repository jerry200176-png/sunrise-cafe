/**
 * Guest booking verification — phone + booking_code required for lookup and mutations.
 */
import { fetchReservationByPhoneAndCode } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-utils";

/** Generic error — do not reveal whether phone or code was wrong */
export const GUEST_BOOKING_NOT_FOUND = "找不到符合的訂位，請確認電話與訂位代號";

export type GuestReservation = Awaited<ReturnType<typeof fetchReservationByPhoneAndCode>>;

export { normalizePhone };

/** Booking codes are 6-char uppercase alphanumeric */
export function normalizeBookingCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isValidBookingCodeFormat(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(normalizeBookingCode(code));
}

export type VerifyGuestBookingResult =
  | { ok: true; reservation: NonNullable<GuestReservation> }
  | { ok: false; error: string; status: 400 | 404 };

/**
 * Verify guest owns a reservation via phone + booking_code pair.
 */
export async function verifyGuestBooking(
  phone: string,
  bookingCode: string
): Promise<VerifyGuestBookingResult> {
  const phoneNorm = normalizePhone(phone);
  const codeNorm = normalizeBookingCode(bookingCode);

  if (!phoneNorm) {
    return { ok: false, error: "請提供電話號碼", status: 400 };
  }
  if (!codeNorm) {
    return { ok: false, error: "請提供訂位代號", status: 400 };
  }
  if (!isValidBookingCodeFormat(codeNorm)) {
    return { ok: false, error: "訂位代號格式不正確（6 碼英數字）", status: 400 };
  }

  const reservation = await fetchReservationByPhoneAndCode(phoneNorm, codeNorm);
  if (!reservation) {
    return { ok: false, error: GUEST_BOOKING_NOT_FOUND, status: 404 };
  }

  return { ok: true, reservation };
}

/**
 * Verify guest booking and ensure reservation id matches (prevents IDOR on mutations).
 */
export async function verifyGuestBookingById(
  phone: string,
  bookingCode: string,
  reservationId: string
): Promise<VerifyGuestBookingResult> {
  const result = await verifyGuestBooking(phone, bookingCode);
  if (!result.ok) return result;
  if (result.reservation.id !== reservationId) {
    return { ok: false, error: GUEST_BOOKING_NOT_FOUND, status: 404 };
  }
  return result;
}
