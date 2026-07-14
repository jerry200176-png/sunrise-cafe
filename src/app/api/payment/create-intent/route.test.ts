import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockStripePaymentIntentsCreate = vi.fn();
const mockSupabaseFromSelectEqSingle = vi.fn();
const mockSupabaseFromInsert = vi.fn();
const mockSupabaseFromUpdateEq = vi.fn(() => Promise.resolve({ error: null }));
const mockSupabaseFrom = vi.fn(() => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      single: mockSupabaseFromSelectEqSingle,
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
  };

  function mockReservationOk(reservation = validReservation) {
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
    expect(body.error).toBe("付款金額不符合分店設定");
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when amount does not match daan branch default (1000 vs 500)", async () => {
    mockReservationOk();

    const res = await POST(
      postRequest({ reservationId: "res-1", branchId: "daan", amount: 1000 })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("付款金額不符合分店設定");
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
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500 }),
      expect.objectContaining({
        idempotencyKey: "reservation_res-1_deposit",
      })
    );
  });

  it("returns 400 when amount does not match unknown branch default (100 vs 0)", async () => {
    mockReservationOk();

    const res = await POST(
      postRequest({
        reservationId: "res-1",
        branchId: "unknown-branch",
        amount: 100,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("付款金額不符合分店設定");
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when amount is 0", async () => {
    mockReservationOk();

    const res = await POST(
      postRequest({ reservationId: "res-1", branchId: "daan", amount: 0 })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("金額必須為正整數（單位：分）");
  });

  it("returns 400 when amount is negative", async () => {
    mockReservationOk();

    const res = await POST(
      postRequest({ reservationId: "res-1", branchId: "daan", amount: -500 })
    );

    expect(res.status).toBe(400);
  });
});
