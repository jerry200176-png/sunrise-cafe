import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { phonesMatch } from "@/lib/phone-utils";
import {
  SlotConflictError,
  isPostgresExclusionViolation,
  isPostgresUniqueViolation,
} from "@/lib/slot-conflict";

const BOOKING_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateBookingCode(): string {
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += BOOKING_CODE_CHARS[bytes[i]! % BOOKING_CODE_CHARS.length];
  }
  return code;
}

/** Service-role Supabase client (server-only). Exported for payment/webhook routes. */
export const supabaseAdmin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

/**
 * 取得管理端用的 URL 與 Headers
 */
export const baseAdmin = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
});

export const headersAdmin = () => {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!serviceRoleKey) {
    // Never silently fall back to anon — that bypasses RLS intent and looks like admin access.
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for admin Supabase access");
  }

  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
};

export function isAdminConfigured() {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export async function fetchBranches() {
  const { data, error } = await supabaseAdmin()
    .from("branches")
    .select("*")
    .is("archived_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchBranch(branchId: string) {
  const { data, error } = await supabaseAdmin()
    .from("branches")
    .select("*")
    .eq("id", branchId)
    .single();
  if (error) return null;
  return data;
}

/**
 * 取得單一房間 (修正：加入 image_url)
 */
export async function fetchRoom(roomId: string): Promise<{
  id: string;
  branch_id: string;
  name: string;
  type: string | null;
  min_capacity?: number;
  capacity: number;
  price_weekday: number;
  price_weekend: number;
  image_url: string | null;
} | null> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}&select=id,branch_id,name,type,min_capacity,capacity,price_weekday,price_weekend,image_url`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );

  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0] ?? null;
}

/**
 * 取得某分店所有房間 (簡易版)
 */
export async function fetchRooms(branchId: string): Promise<{ id: string; name: string; image_url: string | null }[]> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/rooms?branch_id=eq.${encodeURIComponent(branchId)}&select=id,name,image_url&order=name.asc`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!res.ok) throw new Error("Supabase rooms error: " + (await res.text()));
  return res.json();
}

/**
 * 取得某分店所有房間 (詳細版)
 */
export async function fetchRoomsWithDetails(branchId: string): Promise<
  {
    id: string;
    name: string;
    type: string | null;
    min_capacity?: number;
    capacity: number;
    price_weekday: number;
    price_weekend: number;
    image_url: string | null;
  }[]
> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/rooms?branch_id=eq.${encodeURIComponent(branchId)}&select=id,name,type,min_capacity,capacity,price_weekday,price_weekend,image_url&order=name.asc`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch rooms: ${await res.text()}`);
  }

  return res.json();
}

export async function getBlockedSlots(branchId: string, date: string) {
  const { data, error } = await supabaseAdmin().rpc("get_blocked_slots", {
    p_branch_id: branchId,
    p_date: date,
  });
  if (error) {
    console.error("getBlockedSlots error:", error);
    throw error;
  }
  return data as { room_id: string; start_time: string; end_time: string }[];
}

export async function insertReservationAdmin(payload: {
  room_id: string;
  customer_name: string;
  phone: string;
  email: string | null;
  start_time: string;
  end_time: string;
  status?: string;
  total_price: number | null;
  guest_count: number | null;
  notes: string | null;
  line_user_id?: string | null;
}) {
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const bookingCode = generateBookingCode();
    const statusToUse = payload.status ?? "pending";

    const { data, error } = await supabaseAdmin()
      .from("reservations")
      .insert({
        room_id: payload.room_id,
        customer_name: payload.customer_name,
        phone: payload.phone,
        email: payload.email,
        start_time: payload.start_time,
        end_time: payload.end_time,
        status: statusToUse,
        total_price: payload.total_price,
        guest_count: payload.guest_count,
        notes: payload.notes,
        booking_code: bookingCode,
        line_user_id: payload.line_user_id ?? null,
      })
      .select("id, booking_code")
      .single();

    if (!error) return data;

    if (isPostgresExclusionViolation(error)) {
      throw new SlotConflictError();
    }
    if (isPostgresUniqueViolation(error) && attempt < maxAttempts - 1) {
      continue;
    }
    throw error;
  }

  throw new Error("無法產生訂位代號，請稍後再試");
}

// ✅ 補回遺失的函式：updateReservationAdmin
export async function updateReservationAdmin(
  id: string,
  updates: {
    room_id?: string;
    status?: string;
    is_notified?: boolean;
    d1_guest_reminder_sent_at?: string | null;
    is_reminded_7d?: boolean;
    is_deposit_paid?: boolean;
    deposit_payment_note?: string | null;
    deposit_paid_on?: string | null;
    deposit_last_five?: string | null;
    deposit_reminder_sent_at?: string | null;
    deposit_urgent_reminder_sent_at?: string | null;
    payment_request_sent_at?: string | null;
    notes?: string | null;
    customer_name?: string;
    phone?: string;
    email?: string | null;
    start_time?: string;
    end_time?: string;
    total_price?: number | null;
    guest_count?: number | null;
    line_user_id?: string | null;
    review_invited_at?: string | null;
  }
) {
  const { error } = await supabaseAdmin()
    .from("reservations")
    .update(updates)
    .eq("id", id);
  if (error) throw error;
}

// ✅ 補回遺失的函式：deleteReservationAdmin
export async function deleteReservationAdmin(id: string) {
  const { error } = await supabaseAdmin()
    .from("reservations")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/** Branch id for RBAC scope checks on a reservation */
export async function fetchReservationBranchId(
  reservationId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("reservations")
    .select("rooms!inner(branch_id)")
    .eq("id", reservationId)
    .single();
  if (error || !data) return null;
  const rooms = data.rooms as { branch_id: string } | { branch_id: string }[];
  const room = Array.isArray(rooms) ? rooms[0] : rooms;
  return room?.branch_id ?? null;
}

/** Branch id from room_id (recurring admin, etc.) */
export async function fetchRoomBranchId(roomId: string): Promise<string | null> {
  const room = await fetchRoom(roomId);
  return room?.branch_id ?? null;
}

// ✅ 補回遺失的函式：hasSlotConflict
export async function hasSlotConflict(
  roomId: string,
  startTime: string,
  endTime: string,
  excludeReservationId?: string
) {
  let query = supabaseAdmin()
    .from("reservations")
    .select("id")
    .eq("room_id", roomId)
    // Same set as the DB exclusion constraint: cancelled and no_show do not hold the slot.
    .not("status", "in", "(cancelled,no_show)")
    .lt("start_time", endTime)
    .gt("end_time", startTime);

  if (excludeReservationId) {
    query = query.neq("id", excludeReservationId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data && data.length > 0;
}

/** Lookup by unique booking_code, then verify phone matches (guest auth) */
export async function fetchReservationByPhoneAndCode(
  phoneNorm: string,
  bookingCode: string
) {
  const { data, error } = await supabaseAdmin()
    .from("reservations")
    .select(`
      *,
      room:rooms (
        name,
        branch:branches (
          name
        )
      )
    `)
    .eq("booking_code", bookingCode)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (!phonesMatch(data.phone, phoneNorm)) return null;
  return data;
}

/** Lookup reservation by ID (authenticated by signed token) */
export async function fetchReservationById(id: string) {
  const { data, error } = await supabaseAdmin()
    .from("reservations")
    .select(`
      *,
      room:rooms (
        name,
        branch:branches (
          name
        )
      )
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

// ✅ 補回遺失的函式：fetchReservationsByPhone
export async function fetchReservationsByPhone(phone: string) {
  const { data, error } = await supabaseAdmin()
    .from("reservations")
    .select(`
      *,
      room:rooms (
        name,
        branch:branches (
          name
        )
      )
    `)
    .eq("phone", phone)
    .neq("status", "cancelled") // 只抓未取消的
    .order("start_time", { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * Forgot-code recovery: phone + Taipei calendar date of the booking.
 * Loads that day's reservations then matches phone via phonesMatch
 * (stored phones may include dashes / +886).
 */
export async function fetchActiveReservationsByPhoneAndDate(
  phoneNorm: string,
  dateYYYYMMDD: string
) {
  const startRange = `${dateYYYYMMDD}T00:00:00+08:00`;
  const endRange = `${dateYYYYMMDD}T23:59:59.999+08:00`;
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin()
    .from("reservations")
    .select(`
      *,
      room:rooms (
        name,
        branch:branches (
          name
        )
      )
    `)
    .gte("start_time", startRange)
    .lte("start_time", endRange)
    .neq("status", "cancelled")
    .neq("status", "completed")
    .gte("end_time", now)
    .order("start_time", { ascending: true });

  if (error) throw error;
  return (data ?? []).filter((r) => phonesMatch(r.phone, phoneNorm));
}

// ✅ 取得明天所有的訂位（不論是否已發送通知），供儀表板顯示
export async function fetchTomorrowsReservations() {
  const nowTW = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })
  );
  const tomorrow = new Date(nowTW);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getDate()).padStart(2, "0");
  const startRange = `${y}-${m}-${d}T00:00:00+08:00`;
  const endRange = `${y}-${m}-${d}T23:59:59.999+08:00`;

  const { data, error } = await supabaseAdmin()
    .from("reservations")
    .select(`
      id,
      booking_code,
      room_id,
      start_time,
      end_time,
      customer_name,
      phone,
      email,
      guest_count,
      is_notified,
      status,
      is_deposit_paid,
      guest_confirmed_at,
      room:rooms (
        name,
        branch_id,
        branch:branches (
          id,
          name
        )
      )
    `)
    .gte("start_time", startRange)
    .lte("start_time", endRange)
    .neq("status", "cancelled")
    .order("start_time", { ascending: true });

  if (error) {
    // migration 未套用時降級：略過 guest_confirmed_at
    if (/guest_confirmed_at/i.test(error.message)) {
      const fallback = await supabaseAdmin()
        .from("reservations")
        .select(`
      id,
      booking_code,
      room_id,
      start_time,
      end_time,
      customer_name,
      phone,
      email,
      guest_count,
      is_notified,
      status,
      is_deposit_paid,
      room:rooms (
        name,
        branch_id,
        branch:branches (
          id,
          name
        )
      )
    `)
        .gte("start_time", startRange)
        .lte("start_time", endRange)
        .neq("status", "cancelled")
        .order("start_time", { ascending: true });
      if (fallback.error) throw fallback.error;
      return fallback.data;
    }
    throw error;
  }
  return data;
}

// ✅ 明日 LINE 自動提醒包含 pending / confirmed 訂位，不論是否已付訂金。
// force=true 只略過 is_notified 限制。
// delivery ledger additionally prevents overlapping sends.
export async function fetchReservationsForReminder(force: boolean = false) {
  const nowTW = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })
  );
  const tomorrow = new Date(nowTW);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getDate()).padStart(2, "0");
  const startRange = `${y}-${m}-${d}T00:00:00+08:00`;
  const endRange = `${y}-${m}-${d}T23:59:59.999+08:00`;

  let query = supabaseAdmin()
    .from("reservations")
    .select(`
      id,
      booking_code,
      room_id,
      start_time,
      end_time,
      customer_name,
      phone,
      email,
      guest_count,
      is_notified,
      status,
      is_deposit_paid,
      notes,
      line_user_id,
      d1_guest_reminder_sent_at,
      room:rooms (
        name,
        branch_id,
        branch:branches (
          id,
          name
        )
      )
    `)
    .gte("start_time", startRange)
    .lte("start_time", endRange)
    .in("status", ["pending", "confirmed"])
    .order("start_time", { ascending: true });

  if (!force) {
    query = query.or("is_notified.eq.false,d1_guest_reminder_sent_at.is.null");
  }

  const { data, error } = await query;

  if (error && /d1_guest_reminder_sent_at/i.test(error.message)) {
    // Compatibility during the migration rollout; the delivery ledger still
    // protects any rows returned by this legacy query from duplicate pushes.
    const { data: fallback, error: fallbackError } = await supabaseAdmin()
      .from("reservations")
      .select(`
      id, booking_code, room_id, start_time, end_time, customer_name, phone,
      email, guest_count, is_notified, status, is_deposit_paid, notes, line_user_id,
      room:rooms (name, branch_id, branch:branches(id, name))
    `)
      .gte("start_time", startRange)
      .lte("start_time", endRange)
      .in("status", ["pending", "confirmed"])
      .eq("is_notified", false)
      .order("start_time", { ascending: true });
    if (fallbackError) throw fallbackError;
    return fallback;
  }
  if (error) throw error;
  return data;
}

// 取得 7 天後有訂位、已綁定 LINE、尚未發送 D-7 提醒的客人
export async function fetchReservationsIn7Days() {
  const nowTW = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })
  );
  const target = new Date(nowTW);
  target.setDate(target.getDate() + 7);

  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, "0");
  const d = String(target.getDate()).padStart(2, "0");
  const startRange = `${y}-${m}-${d}T00:00:00+08:00`;
  const endRange = `${y}-${m}-${d}T23:59:59.999+08:00`;

  const { data, error } = await supabaseAdmin()
    .from("reservations")
    .select("id, booking_code, customer_name, start_time, end_time, guest_count, notes, line_user_id, room:rooms(name, branch:branches(name))")
    .gte("start_time", startRange)
    .lte("start_time", endRange)
    .in("status", ["pending", "confirmed"])
    .eq("is_reminded_7d", false)
    .not("line_user_id", "is", null)
    .order("start_time", { ascending: true });

  if (error) throw error;
  return data;
}

// 取得尚未付訂金、待處理中的訂位（pending / confirmed，供到期提醒，不因逾期自動取消）
const UNPAID_DEPOSIT_SELECT =
  "id, booking_code, customer_name, phone, start_time, end_time, created_at, status, line_user_id, deposit_reminder_sent_at, deposit_urgent_reminder_sent_at, room:rooms(id, name, branch:branches(name))";
const UNPAID_DEPOSIT_SELECT_LEGACY =
  "id, booking_code, customer_name, phone, start_time, end_time, created_at, status, line_user_id, deposit_reminder_sent_at, room:rooms(id, name, branch:branches(name))";
/** Requested page size; the server may enforce a lower response cap. */
export const UNPAID_DEPOSIT_PAGE_SIZE = 1000;

/**
 * @param opts.startAfter 只取開始時間晚於此時間的訂位。逾期不取消時（ADR-012），
 *   已開始的未付訂位不會再提醒，排除後才不會隨時間累積、擠掉該提醒的訂位。
 */
export async function fetchUnpaidDepositDueReservations(opts: { startAfter?: string } = {}) {
  const readAll = async (columns: string) => {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; ) {
      let query = supabaseAdmin()
        .from("reservations")
        .select(columns)
        .in("status", ["pending", "confirmed"])
        .eq("is_deposit_paid", false);
      if (opts.startAfter) query = query.gt("start_time", opts.startAfter);
      const { data, error } = await query
        .order("start_time", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + UNPAID_DEPOSIT_PAGE_SIZE - 1);
      if (error) return { rows, error };
      const page = (data ?? []) as unknown as Record<string, unknown>[];
      // A short page may reflect the server cap; stop only on an empty page.
      if (page.length === 0) return { rows, error: null };
      rows.push(...page);
      from += page.length;
    }
  };

  const primary = await readAll(UNPAID_DEPOSIT_SELECT);
  if (!primary.error) return primary.rows;
  // migration 未套用時降級：略過 deposit_urgent_reminder_sent_at
  if (/deposit_urgent_reminder_sent_at/i.test(primary.error.message)) {
    const fallback = await readAll(UNPAID_DEPOSIT_SELECT_LEGACY);
    if (fallback.error) throw fallback.error;
    return fallback.rows;
  }
  throw primary.error;
}

/**
 * Return failed group release deliveries for retry after the reservation was
 * already cancelled. The normal unpaid query intentionally excludes cancelled
 * rows, so without this recovery read a failed staff alert could be stranded.
 */
export async function fetchFailedDepositReleaseGroupDeliveries() {
  const { data: deliveries, error: deliveryError } = await supabaseAdmin()
    .from("line_reminder_deliveries")
    .select("id, reservation_id, reminder_date")
    .eq("reminder_type", "deposit_release_group")
    .eq("recipient_type", "group")
    .eq("status", "failed")
    .order("created_at", { ascending: true })
    .limit(100);
  if (deliveryError) throw deliveryError;
  if (!deliveries?.length) return [];

  const reservationIds = deliveries.map((delivery) => String(delivery.reservation_id));
  const { data: reservations, error: reservationError } = await supabaseAdmin()
    .from("reservations")
    .select(
      "id, booking_code, customer_name, phone, start_time, end_time, created_at, status, line_user_id, deposit_reminder_sent_at, deposit_urgent_reminder_sent_at, room:rooms(id, name, branch:branches(name))"
    )
    .in("id", reservationIds);
  if (reservationError) throw reservationError;

  const byId = new Map((reservations ?? []).map((reservation) => [String(reservation.id), reservation]));
  return deliveries.flatMap((delivery) => {
    const reservation = byId.get(String(delivery.reservation_id));
    return reservation
      ? [{ delivery_id: String(delivery.id), reminder_date: String(delivery.reminder_date), reservation }]
      : [];
  });
}

/** @deprecated 使用 fetchUnpaidDepositDueReservations */
export const fetchUnpaidPendingReservations = fetchUnpaidDepositDueReservations;
