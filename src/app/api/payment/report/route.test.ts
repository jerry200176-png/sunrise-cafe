import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  verifyLookupToken: vi.fn(),
  isAdminConfigured: vi.fn(),
  enforceGuestLookupLimit: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));

vi.mock("@/lib/lookup-token", () => ({
  verifyLookupToken: mocks.verifyLookupToken,
}));

vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: mocks.isAdminConfigured,
}));

vi.mock("@/lib/guest-rate-limit", () => ({
  enforceGuestLookupLimit: mocks.enforceGuestLookupLimit,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      }),
  },
}));

import { POST } from "@/app/api/payment/report/route";

function request(body: unknown): Parameters<typeof POST>[0] {
  return new Request("http://localhost/api/payment/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/payment/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminConfigured.mockReturnValue(true);
    mocks.enforceGuestLookupLimit.mockResolvedValue(null);
    mocks.verifyLookupToken.mockReturnValue({ ok: true, reservationId: "reservation-1" });
  });

  it("records a valid report as pending_review without a paid mutation", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ payment_event_id: "event-1", outcome: "submitted", reservation_status: "confirmed" }],
      error: null,
    });

    const response = await POST(request({ token: "signed-token", accountLastFive: "12345", amount: 1500 }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      duplicate: false,
      payment_event_id: "event-1",
      status: "pending_review",
      message: "已收到您的匯款回報，待店家核對後會自動通知您，不需要另外傳 LINE。",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("record_bank_transfer_report", {
      p_reservation_id: "reservation-1",
      p_reported_account_last_five: "12345",
      p_reported_amount: 1500,
    });
  });

  it.each([
    [{ token: "signed-token", accountLastFive: "1234", amount: 1500 }, "accountLastFive"],
    [{ token: "signed-token", accountLastFive: "12A45", amount: 1500 }, "accountLastFive"],
    [{ token: "signed-token", accountLastFive: "12345", amount: 0 }, "amount"],
    [{ token: "signed-token", accountLastFive: "12345", amount: "1,500" }, "amount"],
  ])("rejects malformed customer evidence (%s)", async (body, field) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("makes a duplicate submit successful but marks it duplicate", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ payment_event_id: "event-1", outcome: "duplicate", reservation_status: "confirmed" }],
      error: null,
    });

    const response = await POST(request({ token: "signed-token", accountLastFive: "12345", amount: 1500 }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, duplicate: true, status: "pending_review" });
  });

  it.each([
    ["already_paid", 409],
    ["not_reportable", 409],
  ])("does not regress a reservation for RPC outcome %s", async (outcome, status) => {
    mocks.rpc.mockResolvedValue({
      data: [{ payment_event_id: null, outcome, reservation_status: "cancelled" }],
      error: null,
    });

    const response = await POST(request({ token: "signed-token", accountLastFive: "12345", amount: 1500 }));
    expect(response.status).toBe(status);
  });

  it("rejects an invalid or guessed token before touching the RPC", async () => {
    mocks.verifyLookupToken.mockReturnValue({ ok: false, error: "signature_mismatch" });

    const response = await POST(
      request({ token: "guessed-reservation-id", reservationId: "reservation-2", accountLastFive: "12345", amount: 1500 })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "訂位查詢連結無效，請重新查詢" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uses the reservation bound to the credential, never a client-supplied id", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ payment_event_id: "event-1", outcome: "submitted", reservation_status: "confirmed" }],
      error: null,
    });

    const response = await POST(
      request({ token: "signed-token", reservationId: "reservation-2", accountLastFive: "12345", amount: 1500 })
    );

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_bank_transfer_report", expect.objectContaining({
      p_reservation_id: "reservation-1",
    }));
    expect(mocks.rpc).not.toHaveBeenCalledWith("record_bank_transfer_report", expect.objectContaining({
      p_reservation_id: "reservation-2",
    }));
  });

  it("does not leak payment or customer details when the RPC fails", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "customer@example.com accountLastFive=12345 reservation-1" },
    });

    const response = await POST(request({ token: "signed-token", accountLastFive: "12345", amount: 1500 }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain("customer@example.com");
    expect(JSON.stringify(body)).not.toContain("12345");
    expect(JSON.stringify(body)).not.toContain("reservation-1");
  });
});
