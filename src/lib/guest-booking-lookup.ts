/**
 * Guest booking lookup — shared by GET (legacy) and POST /api/my-bookings.
 * Primary auth: phone + booking_code
 * Forgot-code recovery: phone + booking_date (Taipei calendar day)
 */
import {
  fetchRoom,
  fetchBranch,
  isAdminConfigured,
  fetchActiveReservationsByPhoneAndDate,
} from "@/lib/supabase-admin";
import { isDepositRequired, getDepositAmount } from "@/lib/booking-utils";
import {
  verifyGuestBooking,
  normalizePhone,
  isValidBookingDateFormat,
  isRecoverableBookingDate,
  GUEST_BOOKING_DATE_NOT_FOUND,
} from "@/lib/guest-auth";
import { createClient } from "@supabase/supabase-js";
import { signAttendanceToken } from "@/lib/attendance-token";
import { signLookupToken, verifyLookupToken } from "@/lib/lookup-token";
import { LINE_SITE_URL } from "@/lib/line-flex";
import { isLinePayConfigured } from "@/lib/line-pay";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const ATTENDANCE_WINDOW_MS = 36 * 60 * 60 * 1000;

function shouldOfferAttendanceConfirm(r: {
  status: string;
  start_time: string;
  guest_confirmed_at?: string | null;
}): boolean {
  if (r.guest_confirmed_at) return false;
  if (!["pending", "confirmed"].includes(r.status)) return false;
  const ms = new Date(r.start_time).getTime() - Date.now();
  return ms >= 0 && ms <= ATTENDANCE_WINDOW_MS;
}

export type GuestBookingItem = {
  id: string;
  booking_code: string;
  room_id: string;
  branch_id: string | null;
  room_name: string;
  branch_name: string;
  branch_display_name: string | null;
  branch_address: string | null;
  branch_phone: string | null;
  payment_info: string | null;
  line_pay_url: string | null;
  line_pay_dynamic_enabled: boolean;
  start_time: string;
  end_time: string;
  status: string;
  total_price: number | null;
  guest_count: number | null;
  customer_name: string;
  deposit_required: boolean;
  deposit_amount: number | null;
  is_deposit_paid: boolean;
  created_at: string;
  /** Guest tapped D-1 confirm attendance */
  guest_confirmed_at?: string | null;
  /** Deep link for near-visit attendance confirm (signed; only when eligible) */
  confirm_attendance_url?: string | null;
  /** Latest payment_events status for guest visibility (null if none / unpaid path) */
  payment_review_status?: "pending_review" | "approved" | "rejected" | null;
  /** Signed opaque token for safe deep-link lookup & actions without exposing phone */
  lookup_token?: string | null;
};

type ReservationRow = {
  id: string;
  booking_code: string;
  room_id: string;
  start_time: string;
  end_time: string;
  status: string;
  total_price: number | null;
  guest_count: number | null;
  customer_name: string;
  is_deposit_paid?: boolean | null;
  created_at: string;
  guest_confirmed_at?: string | null;
};

async function toGuestBookingItem(r: ReservationRow): Promise<GuestBookingItem> {
  const room = await fetchRoom(r.room_id);
  const branch = room?.branch_id ? await fetchBranch(room.branch_id) : null;
  const dateStr = r.start_time.slice(0, 10);
  const depositRequired = isDepositRequired(dateStr);

  return {
    id: r.id,
    booking_code: r.booking_code,
    room_id: r.room_id,
    branch_id: room?.branch_id ?? null,
    room_name: room?.name ?? "—",
    branch_name: branch?.name ?? "—",
    branch_display_name: branch?.display_name ?? null,
    branch_address: branch?.address ?? null,
    branch_phone: branch?.phone ?? null,
    payment_info: branch?.payment_info ?? null,
    line_pay_url: branch?.line_pay_url ?? null,
    line_pay_dynamic_enabled: isLinePayConfigured(),
    start_time: r.start_time,
    end_time: r.end_time,
    status: r.status,
    total_price: r.total_price,
    guest_count: r.guest_count,
    customer_name: r.customer_name,
    deposit_required: depositRequired,
    deposit_amount:
      depositRequired && r.total_price != null
        ? getDepositAmount(Number(r.total_price))
        : null,
    is_deposit_paid: !!r.is_deposit_paid,
    created_at: r.created_at,
    guest_confirmed_at: r.guest_confirmed_at ?? null,
    confirm_attendance_url: shouldOfferAttendanceConfirm(r)
      ? `${LINE_SITE_URL}/book/confirm-visit?token=${encodeURIComponent(signAttendanceToken(r.id))}`
      : null,
    payment_review_status: await fetchLatestPaymentReviewStatus(r.id),
    lookup_token: signLookupToken(r.id),
  };
}

async function fetchLatestPaymentReviewStatus(
  reservationId: string
): Promise<"pending_review" | "approved" | "rejected" | null> {
  try {
    const { data, error } = await db()
      .from("payment_events")
      .select("status")
      .eq("reservation_id", reservationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.status) return null;
    if (data.status === "pending_review" || data.status === "approved" || data.status === "rejected") {
      return data.status;
    }
    return null;
  } catch {
    return null;
  }
}

export async function lookupGuestBookings(
  phone: string,
  bookingCode: string
): Promise<
  | { ok: true; items: GuestBookingItem[] }
  | { ok: false; error: string; status: 400 | 404 | 503 | 500 }
> {
  if (!phone?.trim() || !bookingCode?.trim()) {
    return { ok: false, error: "請提供電話號碼與訂位代號", status: 400 };
  }

  if (!isAdminConfigured()) {
    return { ok: false, error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY", status: 503 };
  }

  try {
    const verified = await verifyGuestBooking(phone, bookingCode);
    if (!verified.ok) {
      return { ok: false, error: verified.error, status: verified.status };
    }

    const r = verified.reservation;
    const now = new Date().toISOString();
    if (
      r.status === "completed" ||
      r.status === "cancelled" ||
      r.end_time < now
    ) {
      return { ok: true, items: [] };
    }

    return { ok: true, items: [await toGuestBookingItem(r)] };
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法查詢";
    return { ok: false, error: message, status: 500 };
  }
}

/**
 * Recover booking(s) when the guest forgot the booking code:
 * phone + reservation date (Asia/Taipei calendar day).
 */
export async function lookupGuestBookingsByDate(
  phone: string,
  bookingDate: string
): Promise<
  | { ok: true; items: GuestBookingItem[] }
  | { ok: false; error: string; status: 400 | 404 | 503 | 500 }
> {
  const phoneNorm = normalizePhone(phone ?? "");
  const date = bookingDate?.trim() ?? "";

  if (!phoneNorm) {
    return { ok: false, error: "請提供電話號碼", status: 400 };
  }
  if (!date) {
    return { ok: false, error: "請提供訂位日期", status: 400 };
  }
  if (!isValidBookingDateFormat(date)) {
    return { ok: false, error: "訂位日期格式不正確（YYYY-MM-DD）", status: 400 };
  }
  if (!isRecoverableBookingDate(date)) {
    return {
      ok: false,
      error: "僅可查詢今日起 90 天內的訂位日期",
      status: 400,
    };
  }

  if (!isAdminConfigured()) {
    return { ok: false, error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY", status: 503 };
  }

  try {
    const rows = await fetchActiveReservationsByPhoneAndDate(phoneNorm, date);
    if (rows.length === 0) {
      return { ok: false, error: GUEST_BOOKING_DATE_NOT_FOUND, status: 404 };
    }

    const items = await Promise.all(rows.map((r) => toGuestBookingItem(r)));
    return { ok: true, items };
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法查詢";
    return { ok: false, error: message, status: 500 };
  }
}

/**
 * 1-click lookup via safe signed opaque token.
 * Authenticates the guest without exposing phone numbers in URL query strings.
 */
export async function lookupGuestBookingByToken(
  token: string
): Promise<
  | { ok: true; items: GuestBookingItem[] }
  | { ok: false; error: string; status: 400 | 404 | 503 | 500 }
> {
  if (!token?.trim()) {
    return { ok: false, error: "請提供查詢 token", status: 400 };
  }

  const verified = verifyLookupToken(token);
  if (!verified.ok) {
    const errorMsg =
      verified.error === "expired"
        ? "查詢連結已過期，請使用電話與訂位代號查詢"
        : "查詢連結無效，請確認連結完整性";
    return { ok: false, error: errorMsg, status: 400 };
  }

  if (!isAdminConfigured()) {
    return { ok: false, error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY", status: 503 };
  }

  try {
    const { data: r, error } = await db()
      .from("reservations")
      .select("id, booking_code, room_id, start_time, end_time, status, total_price, guest_count, customer_name, is_deposit_paid, created_at, guest_confirmed_at")
      .eq("id", verified.reservationId)
      .maybeSingle();

    if (error || !r) {
      return { ok: false, error: "找不到符合的訂位", status: 404 };
    }

    const now = new Date().toISOString();
    if (r.status === "completed" || r.status === "cancelled" || r.end_time < now) {
      return { ok: true, items: [] };
    }

    const item = await toGuestBookingItem(r as ReservationRow);
    return { ok: true, items: [item] };
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法查詢";
    return { ok: false, error: message, status: 500 };
  }
}
