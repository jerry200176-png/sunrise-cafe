import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  bookingDraftFromParams,
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

describe("bookingDraftFromParams (LINE chat booking prefill)", () => {
  const ok = "branchId=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&roomId=11111111-2222-4333-8444-555555555555&date=2026-11-25&start=2026-11-25T06%3A00%3A00.000Z&duration=2.5&roomName=A";

  it("lands on the form step and keeps the guest's earlier contact details", () => {
    vi.useFakeTimers({ now: new Date("2026-11-20T02:00:00.000Z") });
    const previous = { v: 1 as const, savedAt: 1, step: "date", branchId: "", branchName: "", roomId: "", roomName: "", date: "", selectedStart: "", duration: 2, name: "王小明", phone: "0912345678", email: "", guestCount: 4 as const };
    expect(bookingDraftFromParams(new URLSearchParams(ok), previous)).toMatchObject({
      step: "form", date: "2026-11-25", selectedStart: "2026-11-25T06:00:00.000Z", duration: 2.5, roomName: "A", name: "王小明", guestCount: 4,
    });
    vi.useRealTimers();
  });

  it("ignores a stale link whose date has passed", () => {
    vi.useFakeTimers({ now: new Date("2026-11-26T02:00:00.000Z") });
    expect(bookingDraftFromParams(new URLSearchParams(ok))).toBeNull();
    vi.useRealTimers();
  });

  it("ignores incomplete or invalid links", () => {
    vi.useFakeTimers({ now: new Date("2026-11-20T02:00:00.000Z") });
    expect(bookingDraftFromParams(new URLSearchParams("line_user_id=U1"))).toBeNull();
    expect(bookingDraftFromParams(new URLSearchParams(ok.replace("duration=2.5", "duration=9")))).toBeNull();
    expect(bookingDraftFromParams(new URLSearchParams(ok.replace("roomId=1111", "roomId=zzzz")))).toBeNull();
    vi.useRealTimers();
  });
});
