/** Tab-local guard only: this is not a server idempotency or cross-device mechanism. */
export const BOOKING_SUBMIT_GUARD_KEY = "sunrise_booking_submit_guard_v1";

type SessionStore = Pick<Storage, "getItem" | "setItem">;

export function readBookingSubmitGuards(store: SessionStore): Set<string> {
  const raw = store.getItem(BOOKING_SUBMIT_GUARD_KEY);
  if (raw === null) return new Set();
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 1000 ||
      !parsed.every((value) => typeof value === "string" && value.length > 0 && value.length <= 500)) {
    throw new Error("Invalid tab booking guard");
  }
  return new Set(parsed);
}

export function writeBookingSubmitGuards(store: SessionStore, keys: Set<string>): void {
  if (keys.size > 1000 || [...keys].some((key) => !key || key.length > 500)) {
    throw new Error("Tab booking guard is too large");
  }
  store.setItem(BOOKING_SUBMIT_GUARD_KEY, JSON.stringify([...keys]));
}
