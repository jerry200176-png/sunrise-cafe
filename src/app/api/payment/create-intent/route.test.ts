import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
// These scenarios exercise payment logic after successful guest authorization.
vi.mock("@/lib/guest-auth", () => ({ verifyGuestBookingByTokenOrCredentials: async () => ({ ok: true, reservation: { id: "fixture" } }) }));
vi.mock("@/lib/guest-rate-limit", () => ({ enforceGuestLookupLimit: async () => null }));
import { verifyStripeIntentForReservation } from "@/lib/deposit-paid";

const mockStripePaymentIntentsCreate = vi.fn();
const mockSupabaseFromSelectEqSingle = vi.fn();
const mockSupabaseFromInsert = vi.fn();
const mockSupabaseFromUpdateEq = vi.fn(() => Promise.resolve({ error: null }));
const mockSupabaseFrom = vi.fn(() => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      single: mockSupabaseFromSelectEqSingle,
      maybeSingle: mockSupabaseFromSelectEqSingle,
    })),
  })),
  insert: mockSupabaseFromInsert,
  update: vi.fn(() => ({
    eq: mockSupabaseFromUpdateEq,
  })),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: {
      create: mockStripePaymentIntentsCreate,
    },
  },
  isStripeEnabled: vi.fn(() => true),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: mockSupabaseFrom,
  })),
}));

vi.mock("@/lib/ops-log", () => ({
  logOps: vi.fn(),
}));

vi.mock("@/lib/constants", () => ({
  getBranchDepositConfig: vi.fn((branchId: string) => ({
    branchId,
    stripeEnabled: branchId === "daan" || branchId === "other-enabled",
    isDepositRequired: branchId === "daan" || branchId === "other-enabled",
    defaultDepositAmount: branchId === "daan" ? 500 : 0,
  })),
}));

// 動態 import 以確保 mock 生效
const { POST } = await import("./route");

const origStripeKey = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
});

afterEach(() => {
  process.env.STRIPE_SECRET_KEY = origStripeKey;
});

function postRequest(body: object) {
  return new NextRequest("http://localhost/api/payment/create-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/payment/create-intent - amount validation", () => {
  const validReservation = {
    id: "res-1",
    status: "confirmed",
    is_deposit_paid: false,
    start_time: new Date(Date.now() + 86400000).toISOString(),
    total_price: 1000,
    room: { branch_id: "daan" },
  };

  function mockReservationOk(reservation: unknown = validReservation) {
    mockSupabaseFromSelectEqSingle.mockResolvedValue({
      data: reservation,
      error: null,
    });
  }

  it("returns 400 when amount does not match daan branch default (1 vs 500)", async () => {
    mockReservationOk();

    const res = await POST(
      postRequest({ reservationId: "res-1", branchId: "daan", amount: 1 })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("付款金額不符合訂位資料");
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when amount does not match daan branch default (1000 vs 500)", async () => {
    mockReservationOk();

    const res = await POST(
      postRequest({ reservationId: "res-1", branchId: "daan", amount: 1000 })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("付款金額不符合訂位資料");
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("proceeds to create PaymentIntent when amount matches daan branch default (500)", async () => {
    mockReservationOk();
    mockStripePaymentIntentsCreate.mockResolvedValue({
      id: "pi_test_123",
      client_secret: "cs_test_abc",
    });
    mockSupabaseFromInsert.mockReturnValue(
      Promise.resolve({ error: null })
    );

    const res = await POST(
      postRequest({ reservationId: "res-1", branchId: "daan", amount: 500 })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clientSecret).toBe("cs_test_abc");
    expect(body.paymentIntentId).toBe("pi_test_123");
    expect(body.amount).toBe(500);
    expect(mockSupabaseFromInsert).toHaveBeenCalledWith(expect.objectContaining({ amount: 50000, currency: "twd", branch_id: "daan" }));
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50000, currency: "twd" }),
      expect.objectContaining({
        idempotencyKey: "reservation_res-1_deposit",
      })
    );
    const providerArgs = mockStripePaymentIntentsCreate.mock.calls[0][0] as { amount: number; currency: string };
    const fx = { intentReservationId: async () => "res-1", totalPrice: async () => 1000 };
    const success = { id: "pi_test_123", object: "payment_intent", status: "succeeded",
      amount: providerArgs.amount, amount_received: providerArgs.amount, currency: providerArgs.currency,
      metadata: { reservationId: "res-1" } };
    expect(await verifyStripeIntentForReservation(success, "res-1", fx)).toEqual({ ok: true });
    expect(await verifyStripeIntentForReservation({ ...success, amount_received: 500 }, "res-1", fx))
      .toMatchObject({ ok: false, status: 409 });
  });

  it("rejects a caller's branch that differs from the reservation branch", async () => {
    mockReservationOk();

    const res = await POST(
      postRequest({
        reservationId: "res-1",
        branchId: "unknown-branch",
        amount: 100,
      })
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("預約與分店資料不符");
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when amount is 0", async () => {
    mockReservationOk();

    const res = await POST(
      postRequest({ reservationId: "res-1", branchId: "daan", amount: 0 })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("金額必須為正整數（單位：元）");
  });

  it("returns 400 when amount is negative", async () => {
    mockReservationOk();

    const res = await POST(
      postRequest({ reservationId: "res-1", branchId: "daan", amount: -500 })
    );

    expect(res.status).toBe(400);
  });

  it("refuses a disabled actual branch without calling the provider", async () => {
    mockReservationOk({ ...validReservation, room: { branch_id: "disabled-branch" } });
    const res = await POST(postRequest({ reservationId: "res-1", branchId: "disabled-branch", amount: 500 }));
    expect(res.status).toBe(503);
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("cannot use a different enabled branch to bypass a disabled actual branch", async () => {
    mockReservationOk({ ...validReservation, room: { branch_id: "disabled-branch" } });
    const res = await POST(postRequest({ reservationId: "res-1", branchId: "other-enabled", amount: 500 }));
    expect(res.status).toBe(403);
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("fails closed when the authoritative branch or reservation price is unavailable", async () => {
    mockReservationOk({ ...validReservation, room: null });
    expect((await POST(postRequest({ reservationId: "res-1", branchId: "daan", amount: 500 }))).status).toBe(503);
    mockReservationOk({ ...validReservation, total_price: null });
    expect((await POST(postRequest({ reservationId: "res-1", branchId: "daan", amount: 500 }))).status).toBe(409);
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("rejects a non-TWD request before calling the provider", async () => {
    mockReservationOk();
    const res = await POST(postRequest({ reservationId: "res-1", branchId: "daan", amount: 500, currency: "usd" }));
    expect(res.status).toBe(400);
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("refuses a mismatch between the fixed branch setting and the reservation deposit", async () => {
    mockReservationOk({ ...validReservation, total_price: 1200 });
    const res = await POST(postRequest({ reservationId: "res-1", branchId: "daan", amount: 600 }));
    expect(res.status).toBe(409);
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("does not expose a provider exception in the response or console", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockReservationOk();
      mockStripePaymentIntentsCreate.mockRejectedValueOnce(new Error("SYNTHETIC_PROVIDER_PRIVATE"));
      const res = await POST(postRequest({ reservationId: "res-1", branchId: "daan", amount: 500 }));
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("SYNTHETIC_PROVIDER_PRIVATE");
      expect(JSON.stringify(stderr.mock.calls)).not.toContain("SYNTHETIC_PROVIDER_PRIVATE");
    } finally {
      stderr.mockRestore();
    }
  });
});
