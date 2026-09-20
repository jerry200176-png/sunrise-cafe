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
    const localStore: Record<string, string> = {};
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
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => localStore[k] ?? null,
      setItem: (k: string, v: string) => {
        localStore[k] = v;
      },
      removeItem: (k: string) => {
        delete localStore[k];
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
      branchName: "大安店",
      branchAddress: "台北市大安區信義路",
      branchPhone: "02-1234-5678",
      paymentInfo: "銀行代碼 004 帳號 123456",
      lookupToken: "token-abc-xyz",
    });
    const successMeta = loadBookingSuccessMeta();
    expect(successMeta?.code).toBe("ABC123");
    expect(successMeta?.branchAddress).toBe("台北市大安區信義路");
    expect(successMeta?.paymentInfo).toBe("銀行代碼 004 帳號 123456");
    expect(successMeta?.lookupToken).toBe("token-abc-xyz");
  });

  it("recovers the draft from localStorage after an OAuth context switch", () => {
    const sessionStore = globalThis.sessionStorage;
    sessionStore.removeItem("sunrise_booking_draft_v1");
    globalThis.localStorage.setItem(
      "sunrise_booking_draft_v1",
      JSON.stringify({
        v: 1,
        savedAt: Date.now(),
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
      })
    );
    expect(loadBookingDraft()?.phone).toBe("0912345678");
  });
});
