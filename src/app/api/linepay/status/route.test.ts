import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { reconcile, deliver, supabaseAdmin } = vi.hoisted(() => ({
  reconcile: vi.fn(), deliver: vi.fn(), supabaseAdmin: vi.fn(),
}));

vi.mock("@/lib/linepay-lifecycle", () => ({
  reconcileLinePayPayment: reconcile,
  safeLinePayError: (error: unknown) => String(error),
}));
vi.mock("@/lib/linepay-notification-outbox", () => ({ deliverLinePayNotification: deliver }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin }));

import { GET } from "./route";

const payment = { id: "p1", reservation_id: "r1", order_id: "order-1", transaction_id: "tx-1", amount: 300, currency: "TWD", status: "pending" };
const reservation = { id: "r1", customer_name: "Test", booking_code: "ABC123", start_time: "2026-08-20T10:00:00+08:00", end_time: "2026-08-20T12:00:00+08:00", is_deposit_paid: false };

function client() {
  return { from: vi.fn((table: string) => ({
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: table === "line_pay_payments" ? payment : reservation, error: null })) })) })),
  })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseAdmin.mockReturnValue(client());
  deliver.mockResolvedValue("sent");
});

describe("LINE Pay status route", () => {
  it("reconciles an interrupted redirect and reports paid", async () => {
    reconcile.mockResolvedValue({ status: "paid", outboxId: "outbox-1" });
    const response = await GET(new NextRequest("http://localhost/api/linepay/status?orderId=order-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "paid" });
    expect(deliver).toHaveBeenCalledWith("outbox-1", expect.anything());
  });

  it("returns 202 for an unknown provider state instead of claiming failure", async () => {
    reconcile.mockResolvedValue({ status: "unknown" });
    const response = await GET(new NextRequest("http://localhost/api/linepay/status?orderId=order-1"));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "unknown" });
  });

  it("requires an order id", async () => {
    const response = await GET(new NextRequest("http://localhost/api/linepay/status"));
    expect(response.status).toBe(400);
  });
});
