import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ branch: null as Record<string, unknown> | null }));
vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: () => true,
  fetchBranch: vi.fn(async () => mocks.branch),
  fetchRoom: vi.fn(async () => ({ id: "room-1", branch_id: "b1", name: "包廂1", type: null, capacity: 6, image_url: null })),
  fetchRoomsWithDetails: vi.fn(async () => [{ id: "room-1", name: "包廂1", type: null, capacity: 6, price_weekday: 200, price_weekend: 250, image_url: null }]),
  getBlockedSlots: vi.fn(async () => []),
}));
vi.mock("@/lib/supabase-fetch", () => ({ fetchSettings: vi.fn(async () => ({ closed_dates: [] })) }));

import * as bookable from "@/lib/bookable";
import { GET } from "./route";

const resolveDaySpy = vi.spyOn(bookable, "resolveDay");

const tongde = {
  id: "b1", name: "昇咖啡 桃園同德店", open_time: "10:00", close_time: "18:00", closed_dates: [],
  weekly_hours: {
    sun: { open: "10:00", close: "18:00" }, mon: null,
    tue: { open: "14:00", close: "18:00" }, wed: { open: "14:00", close: "18:00" },
    thu: { open: "14:00", close: "18:00" }, fri: { open: "14:00", close: "18:00" },
    sat: { open: "10:00", close: "18:00" },
  },
};
const get = (q: string) => GET(new NextRequest(`http://localhost/api/availability?branchId=b1&${q}`));
const taipei = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" });

describe("availability with weekly hours", () => {
  beforeEach(() => {
    mocks.branch = tongde;
    resolveDaySpy.mockClear();
  });

  it.each([
    ["date=2099-10-06", "room list"],
    ["date=2099-10-06&roomId=room-1", "room slots"],
  ])("rejects an archived branch before resolving %s", async (query) => {
    mocks.branch = { ...tongde, archived_at: "2099-10-01T00:00:00Z" };

    const response = await get(query);
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "該分店已停止接受線上預約" });
    expect(resolveDaySpy).not.toHaveBeenCalled();
  });

  it.each([
    ["date=2099-10-06", "room list"],
    ["date=2099-10-06&roomId=room-1", "room slots"],
  ])("rejects a missing branch before resolving %s", async (query) => {
    mocks.branch = null;

    const response = await get(query);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "分店不存在" });
    expect(resolveDaySpy).not.toHaveBeenCalled();
  });

  it("a weekday marked closed is a closed day (both room list and slot views)", async () => {
    expect(await (await get("date=2099-10-05")).json()).toEqual({ closed: true });
    expect(await (await get("date=2099-10-05&roomId=room-1")).json()).toEqual({ closed: true });
  });

  it("slots follow that weekday's hours", async () => {
    // 2099-10-06 is a Tuesday: 14:00-18:00
    const tue = await (await get("date=2099-10-06&roomId=room-1")).json();
    expect(taipei(tue.slots[0].start)).toBe("14:00");
    expect(taipei(tue.slots.at(-1).end)).toBe("18:00");
    expect([tue.openTime, tue.closeTime]).toEqual(["14:00", "18:00"]);
    // 2099-10-10 is a Saturday: 10:00-18:00
    const sat = await (await get("date=2099-10-10")).json();
    expect(taipei(sat.rooms[0].slots[0].start)).toBe("10:00");
  });

  it("branches without weekly hours keep one schedule every day (大安店 unchanged)", async () => {
    mocks.branch = { ...tongde, open_time: "09:00", close_time: "21:00", weekly_hours: null };
    const mon = await (await get("date=2099-10-05&roomId=room-1")).json();
    expect(taipei(mon.slots[0].start)).toBe("09:00");
    expect(taipei(mon.slots.at(-1).end)).toBe("21:00");
  });
});
