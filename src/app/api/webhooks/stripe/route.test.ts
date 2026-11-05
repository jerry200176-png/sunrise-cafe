import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(), update: vi.fn(), ledgerUpdate: vi.fn(), markPaid: vi.fn(), binding: vi.fn(), logOps: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructEvent } },
  isStripeEnabled: () => true,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({ update: mocks.update }),
  }),
}));
vi.mock("@/lib/deposit-paid", () => ({
  markDepositPaid: mocks.markPaid,
  verifyStripeIntentForReservation: mocks.binding,
}));
vi.mock("@/lib/ops-log", () => ({ logOps: mocks.logOps }));

import { POST } from "./route";

function request() {
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST", headers: { "stripe-signature": "synthetic-signature" }, body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.constructEvent.mockReturnValue({
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_synthetic", metadata: { reservationId: "synthetic-reservation" } } },
  });
  mocks.update.mockReturnValue({ eq: mocks.ledgerUpdate });
  mocks.ledgerUpdate.mockResolvedValue({ error: null, count: 1 });
  mocks.binding.mockResolvedValue({ ok: true });
  mocks.markPaid.mockResolvedValue({ changed: true, notification: null });
});

describe("Stripe succeeded webhook retry boundary", () => {
  it("rejects an invalid signature without touching the ledger", async () => {
    mocks.constructEvent.mockImplementation(() => { throw new Error("synthetic bad signature"); });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.ledgerUpdate).not.toHaveBeenCalled();
    expect(mocks.markPaid).not.toHaveBeenCalled();
  });

  it("does not acknowledge a ledger write error or expose its detail", async () => {
    mocks.ledgerUpdate.mockResolvedValue({ error: { message: "synthetic confidential detail" } });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Webhook processing failed" });
    expect(mocks.markPaid).not.toHaveBeenCalled();
  });

  it.each([0, null, 2])("does not mark paid when the exact affected count is %s", async (count) => {
    mocks.ledgerUpdate.mockResolvedValue({ error: null, count });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(mocks.markPaid).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.any(Object), { count: "exact" });
  });

  it("does not acknowledge an exception recording the paid result", async () => {
    mocks.markPaid.mockRejectedValue(new Error("synthetic confidential detail"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("synthetic confidential detail");
    expect(mocks.markPaid).toHaveBeenCalledOnce();
  });

  it.each([403, 409, 503] as const)("does not acknowledge or mutate when binding returns %i", async (status) => {
    mocks.binding.mockResolvedValue({ ok: false, status, error: "synthetic binding issue" });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(mocks.ledgerUpdate).not.toHaveBeenCalled();
    expect(mocks.markPaid).not.toHaveBeenCalled();
  });

  it("does not acknowledge or mutate a success event without reservation metadata", async () => {
    mocks.constructEvent.mockReturnValue({
      type: "payment_intent.succeeded", data: { object: { id: "pi_synthetic", metadata: {} } },
    });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(mocks.ledgerUpdate).not.toHaveBeenCalled();
    expect(mocks.markPaid).not.toHaveBeenCalled();
  });

  it("acknowledges a signed event after successful handling", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mocks.markPaid).toHaveBeenCalledOnce();
  });

  it("lets a redelivery retry after a transient recording error", async () => {
    mocks.markPaid.mockRejectedValueOnce(new Error("synthetic transient failure"))
      .mockResolvedValueOnce({ changed: true, notification: null });
    expect((await POST(request())).status).toBe(500);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.markPaid).toHaveBeenCalledTimes(2);
  });
});
