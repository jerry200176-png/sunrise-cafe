import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  confirmProvider,
  claim,
  finalize,
  reconcile,
  deliver,
  mark,
  providerMatches,
  supabaseAdmin,
} = vi.hoisted(() => ({
  confirmProvider: vi.fn(), claim: vi.fn(), finalize: vi.fn(), reconcile: vi.fn(),
  deliver: vi.fn(), mark: vi.fn(), providerMatches: vi.fn(), supabaseAdmin: vi.fn(),
}));

vi.mock("@/lib/line-pay", () => ({ confirmLinePayPayment: confirmProvider }));
vi.mock("@/lib/linepay-lifecycle", () => ({
  claimPaymentConfirmation: claim,
  finalizeLinePayPayment: finalize,
  markLinePayReconciliation: mark,
  providerPaymentMatches: providerMatches,
  reconcileLinePayPayment: reconcile,
  safeLinePayError: (error: unknown) => String(error),
}));
vi.mock("@/lib/linepay-notification-outbox", () => ({ deliverLinePayNotification: deliver }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin }));
vi.mock("@/lib/payment-log", () => ({ logPayment: vi.fn() }));

import { GET } from "./route";

const payment = {
  id: "p1",
  reservation_id: "r1",
  order_id: "order-1",
  transaction_id: "tx-1",
  amount: 300,
  currency: "TWD",
  status: "pending",
};
const reservation = {
  id: "r1",
  customer_name: "Test",
  booking_code: "ABC123",
  start_time: "2026-08-20T10:00:00+08:00",
  end_time: "2026-08-20T12:00:00+08:00",
  is_deposit_paid: false,
};

function client(opts: { payment?: unknown; paymentError?: unknown; currentStatus?: string }) {
  return {
    from: vi.fn((table: string) => {
      if (table === "line_pay_payments") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: opts.payment ?? payment, error: opts.paymentError ?? null })),
              single: vi.fn(async () => ({ data: { status: opts.currentStatus ?? "confirming" }, error: null })),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: reservation, error: null })) })),
        })),
      };
    }),
  };
}

function request() {
  return new NextRequest("http://localhost/api/linepay/confirm?orderId=order-1&transactionId=tx-1");
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseAdmin.mockReturnValue(client({}));
  claim.mockResolvedValue({ claimed: true, attemptId: "a1" });
  providerMatches.mockReturnValue(true);
  confirmProvider.mockResolvedValue({ returnCode: "0000", info: { orderId: "order-1", transactionId: "tx-1" } });
  finalize.mockResolvedValue("outbox-1");
  deliver.mockResolvedValue("sent");
});

describe("LINE Pay confirm route", () => {
  it("finalizes a successful callback once and queues notification", async () => {
    const response = await GET(request());
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("linepay=success");
    expect(claim).toHaveBeenCalledWith(expect.anything(), "p1");
    expect(finalize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "p1" }), expect.objectContaining({ id: "r1" }), expect.anything(), "tx-1");
    expect(deliver).toHaveBeenCalledWith("outbox-1", expect.anything());
  });

  it("does not call provider again when another callback owns the confirmation", async () => {
    claim.mockResolvedValue({ claimed: false, attemptId: "a2" });
    const response = await GET(request());
    expect(response.headers.get("location")).toContain("linepay=pending");
    expect(confirmProvider).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("keeps local state unknown when provider or database confirmation fails", async () => {
    confirmProvider.mockRejectedValue(new Error("provider timeout"));
    const response = await GET(request());
    expect(response.headers.get("location")).toContain("linepay=pending");
    expect(mark).toHaveBeenCalledWith(expect.anything(), "p1", null, "unknown");
    expect(finalize).not.toHaveBeenCalled();
  });

  it("returns service unavailable when the ledger cannot be read", async () => {
    supabaseAdmin.mockReturnValue(client({ paymentError: { message: "db down" } }));
    const response = await GET(request());
    expect(response.status).toBe(503);
  });
});
