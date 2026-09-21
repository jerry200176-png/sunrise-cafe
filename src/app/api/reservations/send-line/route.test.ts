import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdminApiAuth: vi.fn(),
  isAdminConfigured: vi.fn(),
  fetchReservationBranchId: vi.fn(),
  getAdminContext: vi.fn(),
  assertReservationMessageSendAllowed: vi.fn(),
  sendDepositPaymentRequest: vi.fn(),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requireAdminApiAuth: mocks.requireAdminApiAuth,
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: mocks.isAdminConfigured,
  fetchReservationBranchId: mocks.fetchReservationBranchId,
}));
vi.mock("@/lib/reservation-access", () => ({
  assertReservationMessageSendAllowed: mocks.assertReservationMessageSendAllowed,
}));
vi.mock("@/lib/payment-request-line", () => ({
  sendDepositPaymentRequest: mocks.sendDepositPaymentRequest,
}));

import { POST } from "./route";

function request() {
  return new NextRequest("http://localhost/api/reservations/send-line", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "res-1" }),
  });
}

describe("POST /api/reservations/send-line", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminApiAuth.mockResolvedValue(null);
    mocks.isAdminConfigured.mockReturnValue(true);
    mocks.fetchReservationBranchId.mockResolvedValue("branch-1");
    mocks.getAdminContext.mockResolvedValue({ user_id: "admin-1" });
    mocks.assertReservationMessageSendAllowed.mockReturnValue(null);
  });

  it("reports LINE platform acceptance on a real resend success", async () => {
    mocks.sendDepositPaymentRequest.mockResolvedValue({ result: "sent" });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, result: "sent", delivery_status: "accepted_by_line_platform" });
    expect(mocks.sendDepositPaymentRequest).toHaveBeenCalledWith("res-1", {
      force: true,
      actorUserId: "admin-1",
    });
  });

  it("does not report success when the provider send fails", async () => {
    mocks.sendDepositPaymentRequest.mockResolvedValue({ result: "error", detail: "LINE API 401" });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "LINE API 401" });
  });

  it("reports a missing guest binding explicitly", async () => {
    mocks.sendDepositPaymentRequest.mockResolvedValue({ result: "no_line_id" });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatch(/尚未綁定 LINE/);
  });
});
