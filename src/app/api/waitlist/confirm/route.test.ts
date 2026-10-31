import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  entry: null as Record<string, unknown> | null,
  entryError: null as unknown,
  room: { id: "room-1", branch_id: "branch-1" } as { id: string; branch_id: string } | null,
  roomError: null as unknown,
  branch: { id: "branch-1", archived_at: null, name: "大安店" } as { id: string; archived_at: string | null; name: string } | null,
  branchError: null as unknown,
  from: vi.fn(),
  createClient: vi.fn(),
  hasSlotConflict: vi.fn(),
  insertReservationAdmin: vi.fn(),
  isAdminConfigured: vi.fn(),
  notifyWaitlist: vi.fn(),
  sendLineFlexToBranchGroup: vi.fn(),
  buildWaitlistBookedGroupFlex: vi.fn(),
  branchLineGroupIdForRoom: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase-admin", () => ({
  hasSlotConflict: mocks.hasSlotConflict,
  insertReservationAdmin: mocks.insertReservationAdmin,
  isAdminConfigured: mocks.isAdminConfigured,
}));
vi.mock("@/lib/line-notify", () => ({
  sendLineFlexToBranchGroup: mocks.sendLineFlexToBranchGroup,
  buildWaitlistBookedGroupFlex: mocks.buildWaitlistBookedGroupFlex,
}));
vi.mock("@/lib/waitlist", () => ({
  WAITLIST_CONFIRM_WINDOW_MINUTES: 30,
  notifyWaitlist: mocks.notifyWaitlist,
}));
vi.mock("@/lib/branch-line-group", () => ({ branchLineGroupIdForRoom: mocks.branchLineGroupIdForRoom }));

import { GET, POST } from "./route";

const notifiedAt = new Date().toISOString();
const entryFixture = () => ({
  id: "waitlist-1",
  room_id: "room-1",
  customer_name: "Guest",
  phone: "0912345678",
  start_time: "2099-10-06T10:00:00+08:00",
  end_time: "2099-10-06T12:00:00+08:00",
  status: "notified",
  notified_at: notifiedAt,
  room: {
    name: "包廂 1",
    price_weekday: 200,
    price_weekend: 250,
    branch: { name: "大安店" },
  },
});

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not", "limit", "update", "insert"]) {
    builder[method] = () => builder;
  }
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function post() {
  return POST(new NextRequest("http://localhost/api/waitlist/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "confirm-token" }),
  }));
}

describe("waitlist confirm branch checks", () => {
  beforeEach(() => {
    mocks.entry = entryFixture();
    mocks.entryError = null;
    mocks.room = { id: "room-1", branch_id: "branch-1" };
    mocks.roomError = null;
    mocks.branch = { id: "branch-1", archived_at: null, name: "大安店" };
    mocks.branchError = null;
    mocks.from.mockReset().mockImplementation((table: string) => {
      if (table === "waitlist") return query({ data: mocks.entry, error: mocks.entryError });
      if (table === "rooms") return query({ data: mocks.room, error: mocks.roomError });
      if (table === "branches") return query({ data: mocks.branch, error: mocks.branchError });
      if (table === "reservations") return query({ data: null, error: null });
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.createClient.mockReset().mockReturnValue({ from: mocks.from });
    mocks.isAdminConfigured.mockReset().mockReturnValue(true);
    mocks.hasSlotConflict.mockReset().mockResolvedValue(false);
    mocks.insertReservationAdmin.mockReset().mockResolvedValue({ id: "reservation-1", booking_code: "ABC123" });
    mocks.notifyWaitlist.mockReset().mockResolvedValue(undefined);
    mocks.sendLineFlexToBranchGroup.mockReset().mockResolvedValue(undefined);
    mocks.buildWaitlistBookedGroupFlex.mockReset().mockReturnValue({ type: "flex" });
    mocks.branchLineGroupIdForRoom.mockReset().mockResolvedValue("group-1");
  });

  afterEach(() => vi.restoreAllMocks());

  it("rejects confirmation for a missing room without writing a reservation", async () => {
    mocks.room = null;

    const response = await post();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "包廂或分店不存在，無法完成候補確認" });
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it("rejects confirmation for a missing branch without writing a reservation", async () => {
    mocks.branch = null;

    const response = await post();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "包廂或分店不存在，無法完成候補確認" });
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it("rejects confirmation for an archived branch without writing a reservation", async () => {
    mocks.branch = { id: "branch-1", archived_at: "2099-10-01T00:00:00Z", name: "大安店" };

    const response = await post();
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "該分店已停止接受預約，無法確認候補" });
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it.each(["room", "branch"])("fails closed on %s read errors without writing a reservation", async (target) => {
    if (target === "room") mocks.roomError = new Error("room read failed");
    else mocks.branchError = new Error("branch read failed");

    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "暫時無法確認分店狀態，請稍後再試" });
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it("keeps the existing confirmation-window expiry behavior for an active branch", async () => {
    mocks.entry = { ...entryFixture(), notified_at: new Date(Date.now() - 31 * 60_000).toISOString() };

    const response = await post();
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("已逾時") });
    expect(mocks.notifyWaitlist).toHaveBeenCalledWith(
      "room-1",
      "2099-10-06T10:00:00+08:00",
      "2099-10-06T12:00:00+08:00",
    );
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it("still confirms a notified entry for an active branch", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, id: "reservation-1" });
    expect(mocks.insertReservationAdmin).toHaveBeenCalledOnce();
  });

  it("keeps the confirmation GET available for waitlist history on an archived branch", async () => {
    mocks.branch = { id: "branch-1", archived_at: "2099-10-01T00:00:00Z", name: "大安店" };

    const response = await GET(new NextRequest("http://localhost/api/waitlist/confirm?token=confirm-token"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "notified",
      branch_name: "大安店",
      room_name: "包廂 1",
    });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["waitlist"]);
  });
});
