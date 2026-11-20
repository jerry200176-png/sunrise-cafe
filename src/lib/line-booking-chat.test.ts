import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOM = "11111111-2222-4333-8444-555555555555";
const BRANCH = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER = "99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DATE = "2026-11-25"; // Wednesday
const START = "2026-11-25T06:00:00.000Z"; // 14:00 Taipei

const db = vi.hoisted(() => ({
  room: null as Record<string, unknown> | null,
  branch: null as Record<string, unknown> | null,
  branches: [] as Record<string, unknown>[],
  blocked: [] as Record<string, unknown>[],
  closedDates: [] as string[],
}));
vi.mock("@/lib/supabase-admin", () => ({
  fetchRoom: async () => db.room,
  fetchBranch: async () => db.branch,
  fetchBranches: async () => db.branches,
  fetchRoomsWithDetails: async () => (db.room ? [db.room] : []),
  getBlockedSlots: async () => db.blocked,
  supabaseAdmin: () => ({}),
}));
vi.mock("@/lib/supabase-fetch", () => ({ fetchSettings: async () => ({ closed_dates: db.closedDates }) }));

import { bookingReply } from "./line-booking-chat";

const guest = { userId: "U-guest", branchId: null };
const dur = { a: "dur", r: ROOM, d: DATE, t: START, h: 2 } as const;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-20T02:00:00.000Z") });
  db.room = { id: ROOM, branch_id: BRANCH, name: "A 包廂", capacity: 8, price_weekday: 300, price_weekend: 400 };
  const daan = { id: BRANCH, name: "大安店", open_time: "08:00", close_time: "22:00", archived_at: null };
  db.branch = daan;
  db.branches = [daan];
  db.blocked = [];
  db.closedDates = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("bookingReply", () => {
  it("a free slot ends with the prefilled /book link", async () => {
    const [message] = await bookingReply(dur, guest);
    expect(JSON.stringify(message)).toContain(`roomId=${ROOM}`);
    expect(JSON.stringify(message)).toContain("line_user_id=U-guest");
  });

  it("a slot taken since the button was shown is refused and other times are offered", async () => {
    db.blocked = [{ room_id: ROOM, start_time: "2026-11-25T07:00:00.000Z", end_time: "2026-11-25T09:00:00.000Z" }];
    const messages = await bookingReply(dur, guest);
    expect(messages[0]).toMatchObject({ text: expect.stringContaining("被訂走") });
    expect(JSON.stringify(messages)).not.toContain("/book?");
  });

  it("a closed date offers no times", async () => {
    db.closedDates = [DATE];
    const [message] = await bookingReply({ a: "date", r: ROOM, d: DATE, o: 0 }, guest);
    expect(message).toMatchObject({ text: expect.stringContaining("公休") });
  });

  it("a date outside the booking window is refused", async () => {
    const [message] = await bookingReply({ ...dur, d: "2027-03-01" }, guest);
    expect(message).toMatchObject({ text: expect.stringContaining("不能訂") });
  });

  it("a store's own account never books another store's room", async () => {
    const [message] = await bookingReply(dur, { userId: "U-guest", branchId: OTHER });
    expect(message).toMatchObject({ text: expect.stringContaining("找不到") });
  });

  it("the default account never books a store that has its own account", async () => {
    vi.stubEnv("LINE_BRANCH_CUSTOMER_BOTS", JSON.stringify([{ branch_id: BRANCH, name: "大安", secret: "s", token: "t" }]));
    const [message] = await bookingReply(dur, guest);
    expect(message).toMatchObject({ text: expect.stringContaining("找不到") });
  });

  it("the default account skips stores that have their own account, and asks when several remain", async () => {
    const tongde = { id: OTHER, name: "同德店", archived_at: null };
    db.branches = [db.branch!, tongde];
    const [choice] = await bookingReply({ a: "book" }, guest);
    expect(choice).toMatchObject({ text: "請選擇分店：" });

    vi.stubEnv("LINE_BRANCH_CUSTOMER_BOTS", JSON.stringify([{ branch_id: OTHER, name: "同德", secret: "s", token: "t" }]));
    const [rooms] = await bookingReply({ a: "book" }, guest);
    expect(rooms).toMatchObject({ type: "flex", altText: "大安店｜請選擇包廂" });
  });
});
