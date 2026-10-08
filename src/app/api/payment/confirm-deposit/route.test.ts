import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  tables: {} as Record<string, unknown>,
  updates: [] as { table: string; patch: unknown }[],
  notify: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  isStripeEnabled: () => true,
  stripe: { paymentIntents: { retrieve: mocks.retrieve } },
}));
vi.mock("@/lib/ops-log", () => ({ logOps: vi.fn() }));
vi.mock("@/lib/payment-notify", () => ({ notifyPaymentApproved: mocks.notify }));
vi.mock("@/lib/payment-log", () => ({ logDepositStatusChange: vi.fn(), logPayment: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: mocks.tables[table] ?? null, error: null }),
          maybeSingle: async () => ({ data: mocks.tables[table] ?? null, error: null }),
        }),
      }),
      update: (patch: unknown) => ({
        eq: async () => {
          mocks.updates.push({ table, patch });
          return { error: null };
        },
      }),
    }),
  }),
}));

import { POST } from "./route";

const req = () =>
  new NextRequest("http://localhost/api/payment/confirm-deposit", {
    method: "POST",
    body: JSON.stringify({ paymentIntentId: "pi_1", reservationId: "r1" }),
  });
const paid = () => mocks.updates.filter((u) => u.table === "reservations");

describe("POST /api/payment/confirm-deposit binds the PaymentIntent to the reservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updates.length = 0;
    mocks.notify.mockResolvedValue({ ok: true, accepted_by_platform: true });
    mocks.tables = {
      reservations: { id: "r1", deposit_status: "pending", is_deposit_paid: false, total_price: 1000, status: "confirmed", booking_code: "ABC", deposit_payment_note: null },
      payment_intents: { reservation_id: "r1" },
    };
    mocks.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded", amount: 500, currency: "twd", metadata: { reservationId: "r1" } });
  });

  it("someone else's succeeded PaymentIntent: refused, nothing written", async () => {
    mocks.retrieve.mockResolvedValue({ id: "pi_x", status: "succeeded", amount: 500, currency: "twd", metadata: { reservationId: "other" } });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mocks.updates).toEqual([]);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("underpaid PaymentIntent: refused, nothing written", async () => {
    mocks.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded", amount: 100, currency: "twd", metadata: { reservationId: "r1" } });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(mocks.updates).toEqual([]);
  });

  it("matching, sufficient PaymentIntent: marked paid once", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(paid()).toHaveLength(1);
    expect(paid()[0].patch).toMatchObject({ is_deposit_paid: true, deposit_status: "paid" });
  });

  it("already paid: no second write", async () => {
    mocks.tables.reservations = { ...(mocks.tables.reservations as object), deposit_status: "paid", is_deposit_paid: true };
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(paid()).toHaveLength(0);
  });
});
