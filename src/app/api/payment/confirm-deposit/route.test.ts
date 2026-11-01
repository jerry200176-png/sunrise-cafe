import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  tables: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
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
          single: async () => ({ data: mocks.tables[table] ?? null, error: mocks.errors[table] ?? null }),
          maybeSingle: async () => ({ data: mocks.tables[table] ?? null, error: mocks.errors[table] ?? null }),
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
    mocks.errors = {};
    mocks.notify.mockResolvedValue({ ok: true, accepted_by_platform: true });
    mocks.tables = {
      reservations: { id: "r1", deposit_status: "pending", is_deposit_paid: false, total_price: 1000, status: "confirmed", booking_code: "ABC", deposit_payment_note: null },
      payment_intents: { reservation_id: "r1" },
    };
    mocks.retrieve.mockResolvedValue({ id: "pi_1", object: "payment_intent", status: "succeeded", amount: 50000, amount_received: 50000, currency: "twd", metadata: { reservationId: "r1" } });
  });

  it("someone else's succeeded PaymentIntent: refused, nothing written", async () => {
    mocks.retrieve.mockResolvedValue({ id: "pi_x", object: "payment_intent", status: "succeeded", amount: 50000, amount_received: 50000, currency: "twd", metadata: { reservationId: "other" } });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mocks.updates).toEqual([]);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("underpaid PaymentIntent: refused, nothing written", async () => {
    mocks.retrieve.mockResolvedValue({ id: "pi_1", object: "payment_intent", status: "succeeded", amount: 500, amount_received: 500, currency: "twd", metadata: { reservationId: "r1" } });
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

  it("returns an unavailable response for reservation read errors, not a false 404", async () => {
    mocks.errors.reservations = { message: "synthetic DB failure" };
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(mocks.updates).toEqual([]);
  });

  it("distinguishes an absent reservation from an unavailable lookup", async () => {
    mocks.tables.reservations = null;
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(mocks.updates).toEqual([]);
  });

  it("does not mark paid if the intent binding lookup is unavailable", async () => {
    mocks.errors.payment_intents = { message: "synthetic DB failure" };
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(mocks.updates).toEqual([]);
  });

  it("does not expose a provider exception in the response or console", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.retrieve.mockRejectedValueOnce(new Error("SYNTHETIC_PROVIDER_PRIVATE"));
      const res = await POST(req());
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("SYNTHETIC_PROVIDER_PRIVATE");
      expect(JSON.stringify(stderr.mock.calls)).not.toContain("SYNTHETIC_PROVIDER_PRIVATE");
    } finally {
      stderr.mockRestore();
    }
  });
});
