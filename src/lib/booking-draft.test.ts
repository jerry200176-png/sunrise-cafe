import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clearBookingDraft,
  loadBookingDraft,
  saveBookingDraft,
  saveBookingSuccessMeta,
  loadBookingSuccessMeta,
} from "./booking-draft";

describe("booking-draft", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
  });

  it("round-trips draft in sessionStorage", () => {
    saveBookingDraft({
      step: "form",
      branchId: "b1",
      branchName: "大安店",
      roomId: "r1",
      roomName: "A",
      date: "2026-07-20",
      selectedStart: "2026-07-20T02:00:00.000Z",
      duration: 2,
      name: "王小明",
      phone: "0912345678",
      email: "",
      guestCount: 4,
    });
    const loaded = loadBookingDraft();
    expect(loaded?.step).toBe("form");
    expect(loaded?.phone).toBe("0912345678");
    clearBookingDraft();
    expect(loadBookingDraft()).toBeNull();

    saveBookingSuccessMeta({
      code: "ABC123",
      createdAt: "2026-07-15T00:00:00.000Z",
      startTime: "2026-07-16T02:00:00.000Z",
      depositAmount: 500,
    });
    expect(loadBookingSuccessMeta()?.code).toBe("ABC123");
  });
});
