import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdminApiAuth: vi.fn(),
  getAdminContext: vi.fn(),
  fetchRoom: vi.fn(),
  fetchReservationsByPhone: vi.fn(),
  hasSlotConflict: vi.fn(),
  insertReservationAdmin: vi.fn(),
  isAdminConfigured: vi.fn(),
  assertReservationWriteAllowed: vi.fn(),
  sendDepositPaymentRequest: vi.fn(),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requireAdminApiAuth: mocks.requireAdminApiAuth,
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/reservation-access", () => ({
  assertReservationWriteAllowed: mocks.assertReservationWriteAllowed,
}));
vi.mock("@/lib/supabase-admin", () => ({
  fetchRoom: mocks.fetchRoom,
  fetchReservationsByPhone: mocks.fetchReservationsByPhone,
  hasSlotConflict: mocks.hasSlotConflict,
  insertReservationAdmin: mocks.insertReservationAdmin,
  isAdminConfigured: mocks.isAdminConfigured,
}));
vi.mock("@/lib/payment-request-line", () => ({
  sendDepositPaymentRequest: mocks.sendDepositPaymentRequest,
}));

import { POST } from "./route";

const body = {
  room_id: "room-1",
  customer_name: "測試客人",
  phone: "0912345678",
  email: "test@example.com",
  start_time: "2026-09-05T02:00:00.000Z",
  end_time: "2026-09-05T04:00:00.000Z",
  guest_count: 4,
  notes: "靠窗",
};

function request(payload = body) {
  return new NextRequest("http://localhost/api/admin/reservations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/admin/reservations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiAuth.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({
      user_id: "manager-1",
      role: "branch_manager",
      branch_ids: ["branch-1"],
      legacy: false,
    });
    mocks.isAdminConfigured.mockReturnValue(true);
    mocks.fetchRoom.mockResolvedValue({
      id: "room-1",
      branch_id: "branch-1",
      price_weekday: 1000,
      price_weekend: 1200,
    });
    mocks.fetchReservationsByPhone.mockResolvedValue([]);
    mocks.hasSlotConflict.mockResolvedValue(false);
    mocks.assertReservationWriteAllowed.mockReturnValue(null);
    mocks.insertReservationAdmin.mockResolvedValue({ id: "reservation-1", booking_code: "ABC123" });
    mocks.sendDepositPaymentRequest.mockResolvedValue({ result: "no_line_id" });
  });

  it("requires an admin session", async () => {
    mocks.requireAdminApiAuth.mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it("enforces reservation write permission on the room branch", async () => {
    mocks.assertReservationWriteAllowed.mockReturnValueOnce("Forbidden");

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });

  it("creates a confirmed reservation and preserves an existing LINE binding", async () => {
    mocks.fetchReservationsByPhone.mockResolvedValueOnce([{ line_user_id: "U123" }]);

    const response = await POST(request());
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ ok: true, id: "reservation-1", booking_code: "ABC123" });
    expect(mocks.insertReservationAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "confirmed",
        line_user_id: "U123",
        total_price: 2400,
      })
    );
    expect(mocks.sendDepositPaymentRequest).toHaveBeenCalledWith("reservation-1", {
      force: false,
      actorUserId: "manager-1",
    });
  });

  it("rejects a slot conflict before inserting", async () => {
    mocks.hasSlotConflict.mockResolvedValueOnce(true);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.insertReservationAdmin).not.toHaveBeenCalled();
  });
});
