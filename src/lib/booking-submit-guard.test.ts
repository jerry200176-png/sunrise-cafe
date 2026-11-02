import { describe, expect, it } from "vitest";
import { BOOKING_SUBMIT_GUARD_KEY, readBookingSubmitGuards, writeBookingSubmitGuards } from "./booking-submit-guard";

describe("tab-local booking submit guard", () => {
  it("restores pending selections and removes a confirmed rejection", () => {
    let value: string | null = null;
    const store = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
    const selection = JSON.stringify(["branch", "room", "2026-11-03T02:00:00.000Z", 2]);
    writeBookingSubmitGuards(store, new Set([selection]));
    expect(readBookingSubmitGuards(store).has(selection)).toBe(true);
    writeBookingSubmitGuards(store, new Set());
    expect(readBookingSubmitGuards(store).size).toBe(0);
  });

  it("surfaces corrupt or unavailable storage rather than silently clearing it", () => {
    expect(() => readBookingSubmitGuards({ getItem: () => "{", setItem: () => {} })).toThrow();
    expect(() => readBookingSubmitGuards({ getItem: () => JSON.stringify([null]), setItem: () => {} })).toThrow();
    expect(() => writeBookingSubmitGuards({ getItem: () => null, setItem: () => { throw new Error("denied"); } }, new Set(["selection"]))).toThrow();
    expect(BOOKING_SUBMIT_GUARD_KEY).toBe("sunrise_booking_submit_guard_v1");
  });
});
