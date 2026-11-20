import { describe, expect, it } from "vitest";
import { buildHalfHourSlots } from "./slot-grid";
import {
  STARTS_PER_PAGE,
  confirmMessage,
  durationsMessage,
  parseBookingPostback,
  roomsMessage,
  startsMessage,
} from "./line-booking-menu";

const ROOM = "11111111-2222-4333-8444-555555555555";
const BRANCH = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const room = { id: ROOM, branch_id: BRANCH, name: "A 包廂", capacity: 8, min_capacity: 4, price_weekday: 300, price_weekend: 400 };
// 2026-11-25 is a Wednesday; open 08:00–22:00 Taipei.
const DATE = "2026-11-25";
const day = (blocked: { start_time: string; end_time: string }[] = []) =>
  buildHalfHourSlots({ dayStartIso: "2026-11-25T00:00:00.000Z", dayEndIso: "2026-11-25T14:00:00.000Z", blocked, isToday: false });

type Quick = { action: { label: string; data?: string } };
const quickItems = (m: Record<string, unknown> | null) => ((m?.quickReply as { items: Quick[] }).items);

describe("parseBookingPostback", () => {
  it("reads each step", () => {
    expect(parseBookingPostback("a=book")).toEqual({ a: "book" });
    expect(parseBookingPostback(`a=book&b=${BRANCH}`)).toEqual({ a: "book", b: BRANCH });
    expect(parseBookingPostback("a=mine")).toEqual({ a: "mine" });
    expect(parseBookingPostback(`a=date&r=${ROOM}`, DATE)).toEqual({ a: "date", r: ROOM, d: DATE, o: 0 });
    expect(parseBookingPostback(`a=date&r=${ROOM}&d=${DATE}&o=12`)).toEqual({ a: "date", r: ROOM, d: DATE, o: 12 });
    expect(parseBookingPostback(`a=dur&r=${ROOM}&d=${DATE}&t=2026-11-25T06%3A00%3A00.000Z&h=2.5`)).toEqual({
      a: "dur", r: ROOM, d: DATE, t: "2026-11-25T06:00:00.000Z", h: 2.5,
    });
  });

  it("rejects anything it cannot trust", () => {
    expect(parseBookingPostback("")).toBeNull();
    expect(parseBookingPostback("a=date&r=not-a-uuid", DATE)).toBeNull();
    expect(parseBookingPostback(`a=date&r=${ROOM}`)).toBeNull(); // no date picked
    expect(parseBookingPostback(`a=start&r=${ROOM}&d=${DATE}&t=soon`)).toBeNull();
    expect(parseBookingPostback(`a=dur&r=${ROOM}&d=${DATE}&t=2026-11-25T06:00:00.000Z&h=9`)).toBeNull();
    expect(parseBookingPostback(`a=dur&r=${ROOM}&d=${DATE}&t=2026-11-25T06:00:00.000Z&h=2.25`)).toBeNull();
  });
});

describe("startsMessage", () => {
  it("pages start times within LINE limits and round-trips its own buttons", () => {
    const first = quickItems(startsMessage(room, DATE, day(), 0));
    expect(first).toHaveLength(STARTS_PER_PAGE + 1);
    expect(first[0].action.label).toBe("08:00");
    for (const item of first) {
      expect(item.action.label.length).toBeLessThanOrEqual(20);
      expect(item.action.data!.length).toBeLessThanOrEqual(300);
      expect(parseBookingPostback(item.action.data!)).not.toBeNull();
    }
    expect(parseBookingPostback(first[first.length - 1].action.data!)).toMatchObject({ a: "date", o: STARTS_PER_PAGE });
    // 08:00–22:00 fits 25 two-hour starts: 12 + 12 + 1, and the last page has no "more" button.
    expect(quickItems(startsMessage(room, DATE, day(), 24))).toHaveLength(1);
  });

  it("offers nothing when no 2-hour window is free", () => {
    const blocked = [{ start_time: "2026-11-25T01:30:00.000Z", end_time: "2026-11-25T12:30:00.000Z" }];
    expect(startsMessage(room, DATE, day(blocked), 0)).toBeNull();
  });
});

describe("durationsMessage", () => {
  it("only offers durations that fit before the next booking", () => {
    const blocked = [{ start_time: "2026-11-25T05:00:00.000Z", end_time: "2026-11-25T07:00:00.000Z" }]; // 13:00–15:00
    const items = quickItems(durationsMessage(room, DATE, "2026-11-25T02:00:00.000Z", day(blocked))); // from 10:00
    expect(items.map((i) => parseBookingPostback(i.action.data!))).toMatchObject([{ h: 2 }, { h: 2.5 }, { h: 3 }]);
    expect(items[0].action.label).toContain("12:00");
    expect(durationsMessage(room, DATE, "2026-11-25T04:00:00.000Z", day(blocked))).toBeNull(); // 12:00 has 1h left
  });
});

describe("confirmMessage", () => {
  it("links to /book with the choice prefilled and shows the server price formula", () => {
    const message = confirmMessage({
      branch: { id: BRANCH, name: "大安店" }, room, date: DATE, start: "2026-11-25T06:00:00.000Z", hours: 2.5, lineUserId: "U-guest",
    });
    const json = JSON.stringify(message);
    expect(json).toContain("NT$750"); // weekday 300 × 2.5h
    expect(json).toContain("14:00–16:30");
    const uri = json.match(/"uri":"([^"]+\/book\?[^"]+)"/)![1];
    const q = new URL(uri).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({
      branchId: BRANCH, roomId: ROOM, date: DATE, start: "2026-11-25T06:00:00.000Z", duration: "2.5", line_user_id: "U-guest", roomName: "A 包廂",
    });
  });
});

describe("roomsMessage", () => {
  it("caps the carousel at 12 rooms and bounds the date picker", () => {
    const rooms = Array.from({ length: 15 }, (_, i) => ({ ...room, name: `包廂 ${i}` }));
    const message = roomsMessage("大安店", rooms, { min: "2026-11-20", max: "2026-12-20" }) as { contents: { contents: unknown[] } };
    expect(message.contents.contents).toHaveLength(12);
    expect(JSON.stringify(message.contents.contents[0])).toContain('"type":"datetimepicker"');
    expect(JSON.stringify(message.contents.contents[0])).toContain('"min":"2026-11-20","max":"2026-12-20"');
  });
});
