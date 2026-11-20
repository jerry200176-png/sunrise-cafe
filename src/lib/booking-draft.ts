import { getDurationOptions } from "@/lib/slot-grid";
import { taipeiDateString } from "@/lib/datetime";

/** Persist /book wizard progress so mobile refresh doesn't abandon the funnel. */
export const BOOKING_DRAFT_KEY = "sunrise_booking_draft_v1";
export const BOOKING_SUCCESS_META_KEY = "booking_success_meta";

export type BookingDraft = {
  v: 1;
  savedAt: number;
  step: string;
  branchId: string;
  branchName: string;
  roomId: string;
  roomName: string;
  date: string;
  selectedStart: string;
  duration: number;
  name: string;
  phone: string;
  email: string;
  guestCount: number | "";
};

export type BookingSuccessMeta = {
  reservationId?: string;
  code: string;
  createdAt: string;
  startTime: string;
  endTime?: string;
  totalPrice?: number | null;
  depositAmount?: number | null;
  roomName?: string;
  branchName?: string;
  branchAddress?: string | null;
  branchPhone?: string | null;
  paymentInfo?: string | null;
  linePayUrl?: string | null;
  customerName?: string;
  lookupToken?: string | null;
};

const DRAFT_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function readStorage(key: string): string | null {
  const storages = [
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
    typeof localStorage !== "undefined" ? localStorage : null,
  ];
  for (const storage of storages) {
    if (!storage) continue;
    try {
      const value = storage.getItem(key);
      if (value) return value;
    } catch {
      /* private mode / unavailable storage */
    }
  }
  return null;
}

function removeFromStorages(key: string): void {
  const storages = [
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
    typeof localStorage !== "undefined" ? localStorage : null,
  ];
  for (const storage of storages) {
    if (!storage) continue;
    try {
      storage.removeItem(key);
    } catch {
      /* ignore unavailable storage */
    }
  }
}

export function loadBookingDraft(): BookingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = readStorage(BOOKING_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookingDraft;
    if (parsed?.v !== 1 || !parsed.savedAt) return null;
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      removeFromStorages(BOOKING_DRAFT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveBookingDraft(draft: Omit<BookingDraft, "v" | "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: BookingDraft = { ...draft, v: 1, savedAt: Date.now() };
    const serialized = JSON.stringify(payload);
    sessionStorage.setItem(BOOKING_DRAFT_KEY, serialized);
    try {
      localStorage.setItem(BOOKING_DRAFT_KEY, serialized);
    } catch {
      /* sessionStorage is sufficient outside an OAuth context */
    }
  } catch {
    /* private mode / quota */
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 從 LINE 聊天室訂位帶來的網址參數（包廂／日期／開始／時長）組成草稿，直接落在填資料那一步。
 * 聯絡資料沿用客人先前的草稿。參數不完整或不合法時回 null（照一般流程走）；
 * 時段是否真的可訂仍由送出時的 /api/reservations 檢查。
 */
export function bookingDraftFromParams(
  params: URLSearchParams,
  previous: BookingDraft | null = null
): Omit<BookingDraft, "v" | "savedAt"> | null {
  const branchId = params.get("branchId") ?? "";
  const roomId = params.get("roomId") ?? "";
  const date = params.get("date") ?? "";
  const selectedStart = params.get("start") ?? "";
  const duration = Number(params.get("duration"));
  if (!UUID.test(branchId) || !UUID.test(roomId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < taipeiDateString()) return null;
  if (!Number.isFinite(Date.parse(selectedStart)) || !getDurationOptions().includes(duration)) return null;
  return {
    step: "form",
    branchId,
    branchName: params.get("branchName") ?? "",
    roomId,
    roomName: params.get("roomName") ?? "",
    date,
    selectedStart: new Date(selectedStart).toISOString(),
    duration,
    name: previous?.name ?? "",
    phone: previous?.phone ?? "",
    email: previous?.email ?? "",
    guestCount: previous?.guestCount ?? "",
  };
}

export function clearBookingDraft(): void {
  if (typeof window === "undefined") return;
  removeFromStorages(BOOKING_DRAFT_KEY);
}

export function saveBookingSuccessMeta(meta: BookingSuccessMeta): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(BOOKING_SUCCESS_META_KEY, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

export function loadBookingSuccessMeta(): BookingSuccessMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(BOOKING_SUCCESS_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BookingSuccessMeta;
  } catch {
    return null;
  }
}
