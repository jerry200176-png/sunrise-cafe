import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verify, requestProvider, supabaseAdmin, getDepositAmount, isAdminConfigured, isLinePayConfigured } = vi.hoisted(() => ({
  verify: vi.fn(), requestProvider: vi.fn(), supabaseAdmin: vi.fn(), getDepositAmount: vi.fn(),
  isAdminConfigured: vi.fn(), isLinePayConfigured: vi.fn(),
}));

vi.mock("@/lib/guest-auth", () => ({ verifyGuestBookingById: verify }));
vi.mock("@/lib/line-pay", () => ({ isLinePayConfigured, requestLinePayPayment: requestProvider }));
vi.mock("@/lib/booking-utils", () => ({ getDepositAmount }));
const { computeDepositDeadline } = vi.hoisted(() => ({ computeDepositDeadline: vi.fn() }));
vi.mock("@/lib/deposit-deadline", async () => ({
  ...(await vi.importActual<typeof import("@/lib/deposit-deadline")>("@/lib/deposit-deadline")),
  computeDepositDeadline,
}));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured, supabaseAdmin }));
vi.mock("@/lib/payment-log", () => ({ logPayment: vi.fn() }));

import { POST } from "./route";

const reservation = {
  id: "r1", booking_code: "ABC123", customer_name: "Test", status: "confirmed", is_deposit_paid: false,
  total_price: 1000, created_at: "2026-08-01T00:00:00Z", start_time: new Date(Date.now() + 48 * 3600000).toISOString(),
};

function client(existing: unknown = null, insertError: unknown = null) {
  const pendingQuery = {
    eq: vi.fn(() => pendingQuery),
    order: vi.fn(() => ({ limit: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: existing, error: null })) })) })),
  };
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => pendingQuery),
      })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      insert: vi.fn(async () => ({ error: insertError })),
    })),
  };
}

function request() {
  return new NextRequest("http://localhost/api/linepay/request", {
    method: "POST",
    body: JSON.stringify({ reservation_id: "r1", phone: "0912345678", booking_code: "ABC123" }),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEPOSIT_DEADLINE_AUTO_CANCEL;
  computeDepositDeadline.mockReturnValue(new Date(Date.now() + 3600000));
  isAdminConfigured.mockReturnValue(true);
  isLinePayConfigured.mockReturnValue(true);
  getDepositAmount.mockReturnValue(300);
  verify.mockResolvedValue({ ok: true, reservation });
  requestProvider.mockResolvedValue({ returnCode: "0000", info: { transactionId: "tx-1", paymentUrl: { web: "https://pay.example/web", app: "https://pay.example/app" } } });
  supabaseAdmin.mockReturnValue(client());
});

describe("LINE Pay request route", () => {
  it("reuses the same unexpired payment instead of creating a duplicate", async () => {
    supabaseAdmin.mockReturnValue(client({ order_id: "old-order", transaction_id: "tx-old", amount: 300, payment_url_web: "https://pay.example/existing", payment_url_app: null, expires_at: new Date(Date.now() + 60000).toISOString(), status: "pending" }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).reused).toBe(true);
    expect(requestProvider).not.toHaveBeenCalled();
  });

  it("creates a payment from server-side reservation values", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).paymentUrl.web).toContain("pay.example");
    expect(requestProvider).toHaveBeenCalledWith(expect.objectContaining({ amount: 300, orderId: expect.stringContaining("SUNRISE-ABC123-") }));
  });

  it("does not claim success when the provider request fails", async () => {
    requestProvider.mockRejectedValue(new Error("provider down"));
    const response = await POST(request());
    expect(response.status).toBe(502);
  });

  it("surfaces an insert conflict as a failed request rather than duplicating locally", async () => {
    supabaseAdmin.mockReturnValue(client(null, { code: "23505", message: "unique conflict" }));
    const response = await POST(request());
    expect(response.status).toBe(502);
  });

  describe("deposit deadline (ADR-012)", () => {
    const past = () => new Date(Date.now() - 3600000);

    it("still lets the guest pay after the deadline while auto-cancel is off", async () => {
      computeDepositDeadline.mockReturnValue(past());
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(requestProvider).toHaveBeenCalled();
    });

    it("refuses once the reservation has started while auto-cancel is off", async () => {
      verify.mockResolvedValue({ ok: true, reservation: { ...reservation, start_time: past().toISOString() } });
      const response = await POST(request());
      expect(response.status).toBe(409);
      expect(requestProvider).not.toHaveBeenCalled();
    });

    it("refuses after the deadline when DEPOSIT_DEADLINE_AUTO_CANCEL=true", async () => {
      process.env.DEPOSIT_DEADLINE_AUTO_CANCEL = "true";
      computeDepositDeadline.mockReturnValue(past());
      const response = await POST(request());
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain("訂金期限已過");
      delete process.env.DEPOSIT_DEADLINE_AUTO_CANCEL;
    });

    it("refuses cancelled reservations regardless of the switch", async () => {
      verify.mockResolvedValue({ ok: true, reservation: { ...reservation, status: "cancelled" } });
      expect((await POST(request())).status).toBe(409);
    });
  });
});
