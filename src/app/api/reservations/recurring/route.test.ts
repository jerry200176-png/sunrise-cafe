import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSignedAdminSession } from "@/lib/admin-api-auth";

const mocks = vi.hoisted(() => ({
  fetchRoom: vi.fn(),
  insertReservationAdmin: vi.fn(async () => {}),
  checkBookable: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: () => true,
  fetchRoom: mocks.fetchRoom,
  insertReservationAdmin: mocks.insertReservationAdmin,
}));
vi.mock("@/lib/bookable", () => ({
  BOOKABLE_HTTP: {},
  checkBookable: mocks.checkBookable,
}));
import { POST } from "./route";

async function request(role?: "finance" | "staff" | "branch_manager" | "owner") {
  const cookie = role ? `admin_session=${await createSignedAdminSession("test-session", 3600, { role, sub: "test-user", branch_ids: role === "owner" ? null : ["allowed"] })}` : "";
  return new NextRequest("http://localhost/api/reservations/recurring", {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ room_id: "synthetic", customer_name: "測試", phone: "0900000000", start_date: "2027-01-01", start_time: "10:00", duration_hours: 2, repeat_weeks: 4 }),
  });
}

describe("週期訂位遵守角色與分店範圍", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "test-admin");
    vi.stubEnv("SESSION_SECRET", "test-session");
    vi.clearAllMocks();
    mocks.fetchRoom.mockReset();
    mocks.fetchRoom.mockResolvedValue({ id: "synthetic", branch_id: "other", price_weekday: 100, price_weekend: 120 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("未登入拒絕且不查詢包廂", async () => {
    expect((await POST(await request())).status).toBe(401);
    expect(mocks.fetchRoom).not.toHaveBeenCalled();
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it.each(["finance", "staff"] as const)("%s 無新增訂位權限", async (role) => {
    expect((await POST(await request(role))).status).toBe(403);
    expect(mocks.fetchRoom).not.toHaveBeenCalled();
    expect(mocks.checkBookable).not.toHaveBeenCalled();
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it("店長的跨店包廂與不存在包廂回應相同，且不得檢查時段或寫入", async () => {
    const foreign = await POST(await request("branch_manager"));
    mocks.fetchRoom.mockResolvedValueOnce(null);
    const missing = await POST(await request("branch_manager"));
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect(mocks.checkBookable).not.toHaveBeenCalled();
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it.each(["finance", "staff"] as const)("%s 對自己分店也無新增訂位權限", async (role) => {
    mocks.fetchRoom.mockResolvedValueOnce({ id: "synthetic", branch_id: "allowed", price_weekday: 100, price_weekend: 120 });
    expect((await POST(await request(role))).status).toBe(403);
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it("包廂缺少分店時拒絕，不能視為不受限", async () => {
    mocks.fetchRoom.mockResolvedValueOnce({ id: "synthetic", branch_id: null, price_weekday: 100, price_weekend: 120 });
    expect((await POST(await request("branch_manager"))).status).toBe(404);
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it("店長可為被授權分店建立四筆週期訂位", async () => {
    mocks.fetchRoom.mockResolvedValueOnce({ id: "synthetic", branch_id: "allowed", price_weekday: 100, price_weekend: 120 });
    const response = await POST(await request("branch_manager"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 4, skipped: 0 });
    expect(mocks.insertReservationAdmin).toHaveBeenCalledTimes(4);
  });

  it("owner 可為任一分店建立週期訂位", async () => {
    const response = await POST(await request("owner"));
    expect(response.status).toBe(200);
    expect(mocks.insertReservationAdmin).toHaveBeenCalledTimes(4);
  });
});
