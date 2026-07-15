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
  code: string;
  createdAt: string;
  startTime: string;
  endTime?: string;
  totalPrice?: number | null;
  depositAmount?: number | null;
  roomName?: string;
  branchName?: string;
  customerName?: string;
};

const DRAFT_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export function loadBookingDraft(): BookingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(BOOKING_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookingDraft;
    if (parsed?.v !== 1 || !parsed.savedAt) return null;
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      sessionStorage.removeItem(BOOKING_DRAFT_KEY);
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
    sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
}

export function clearBookingDraft(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(BOOKING_DRAFT_KEY);
  } catch {
    /* ignore */
  }
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
