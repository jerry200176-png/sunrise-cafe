import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), fetchRoom: vi.fn(), checkBookable: vi.fn(), insertReservationAdmin: vi.fn(),
  sendLineFlexToBranchGroup: vi.fn(), fetchBranchLineGroupIdForRoom: vi.fn(), logOps: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase-admin", () => ({
  fetchRoom: mocks.fetchRoom,
  insertReservationAdmin: mocks.insertReservationAdmin, isAdminConfigured: () => true,
}));
vi.mock("@/lib/bookable", async (orig) => ({
  ...(await orig<typeof import("@/lib/bookable")>()),
  checkBookable: mocks.checkBookable,
}));
vi.mock("@/lib/reservation-preorder", () => ({
  canonicalDraftItems: (items: unknown[]) => items,
  isReservationPreorderEnabled: () => true,
  fetchPreorderSummaries: vi.fn(),
}));
vi.mock("@/lib/booking-utils", () => ({ computeReservationTotalPrice: () => 600 }));
vi.mock("@/lib/line-notify", () => ({ sendLineFlexToBranchGroup: mocks.sendLineFlexToBranchGroup, buildNewBookingFlex: () => ({}) }));
vi.mock("@/lib/branch-line-group", () => ({ branchLineGroupIdForRoom: (_db: unknown, roomId: string) => mocks.fetchBranchLineGroupIdForRoom(roomId) }));
vi.mock("@/lib/ops-log", () => ({ logOps: mocks.logOps }));
vi.mock("@/lib/lookup-token", () => ({ signLookupToken: () => "lookup" }));
vi.mock("@/lib/line-retry-key", () => ({ stableLineRetryKey: () => "retry" }));

import { POST } from "./route";

const base = {
  room_id: "00000000-0000-0000-0000-000000000001", customer_name: "測試客人",
  phone: "0912345678", start_time: "2026-10-10T02:00:00.000Z",
  end_time: "2026-10-10T04:00:00.000Z", line_user_id: "line-user",
  total_price: 1, booking_request_key: "12345678-1234-1234-1234-123456789abc",
};
function request(extra: object) {
  return new NextRequest("http://localhost/api/reservations", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...base, ...extra }),
  });
}

describe("booking meals submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRoom.mockResolvedValue({ id: base.room_id, branch_id: "branch-1" });
    mocks.checkBookable.mockResolvedValue({ ok: true });
    mocks.rpc.mockResolvedValue({ data: { id: "reservation-1", booking_code: "ABC123" }, error: null });
    mocks.insertReservationAdmin.mockResolvedValue({ id: "reservation-2", booking_code: "DEF456" });
    mocks.sendLineFlexToBranchGroup.mockResolvedValue(undefined);
    mocks.fetchBranchLineGroupIdForRoom.mockResolvedValue(null);
  });

  it("uses the atomic RPC and server-computed room price when meals are selected", async () => {
    const meals = [{ menu_item_id: "00000000-0000-0000-0000-000000000002", quantity: 2, option_ids: [] }];
    const response = await POST(request({ meal_items: meals }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("create_booking_with_meals", expect.objectContaining({
      p_items: meals, p_idempotency_key: base.booking_request_key,
      p_booking: expect.objectContaining({ total_price: 600 }),
    }));
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
    expect(mocks.checkBookable).toHaveBeenCalledWith(base.room_id, base.start_time, base.end_time, { actor: "guest", checkConflict: false });
  });

  it("preserves the existing booking path when meals are skipped", async () => {
    const response = await POST(request({ meal_items: [] }));
    expect(response.status).toBe(200);
    expect(mocks.insertReservationAdmin).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not create a separate reservation after an atomic RPC error", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "invalid menu item" } });
    const response = await POST(request({ meal_items: [{ menu_item_id: "00000000-0000-0000-0000-000000000002", quantity: 1 }] }));
    expect(response.status).toBe(500);
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
    expect(mocks.sendLineFlexToBranchGroup).not.toHaveBeenCalled();
  });

  it("notifies the booked room's branch group", async () => {
    mocks.fetchBranchLineGroupIdForRoom.mockResolvedValue("C-tongde-group");
    const response = await POST(request({ meal_items: [] }));
    expect(response.status).toBe(200);
    expect(mocks.fetchBranchLineGroupIdForRoom).toHaveBeenCalledWith(base.room_id);
    expect(mocks.sendLineFlexToBranchGroup).toHaveBeenCalledWith(
      expect.stringContaining("新訂位申請"), expect.anything(), "C-tongde-group", expect.anything()
    );
  });
});
