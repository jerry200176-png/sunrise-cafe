import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { reconcile, deliver, supabaseAdmin } = vi.hoisted(() => ({ reconcile: vi.fn(), deliver: vi.fn(), supabaseAdmin: vi.fn() }));
vi.mock("@/lib/linepay-lifecycle", () => ({ reconcileLinePayPayment: reconcile, safeLinePayError: (error: unknown) => String(error) }));
vi.mock("@/lib/linepay-notification-outbox", () => ({ deliverLinePayNotification: deliver }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin }));

import { GET } from "./route";

const payment = { id: "p1", reservation_id: "r1", order_id: "order-1", transaction_id: "tx-1", amount: 300, currency: "TWD", status: "pending" };
const reservation = { id: "r1", customer_name: "Test", booking_code: "ABC123", start_time: "2026-08-20T10:00:00+08:00", end_time: "2026-08-20T12:00:00+08:00", is_deposit_paid: false };

function client() {
  const update = vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn(async () => ({ error: null })) })) }));
  return { from: vi.fn((table: string) => ({
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: table === "line_pay_payments" ? payment : reservation, error: null })) })) })),
    update,
  })) };
}

beforeEach(() => { vi.clearAllMocks(); supabaseAdmin.mockReturnValue(client()); deliver.mockResolvedValue("sent"); });

describe("LINE Pay cancel route", () => {
  it("reconciles provider-completed payment instead of cancelling it", async () => {
    reconcile.mockResolvedValue({ status: "paid", outboxId: "outbox-1" });
    const response = await GET(new NextRequest("http://localhost/api/linepay/cancel?orderId=order-1"));
    expect(response.headers.get("location")).toContain("linepay=success");
    expect(deliver).toHaveBeenCalledWith("outbox-1", expect.anything());
  });

  it("keeps an ordinary cancelled redirect non-paid", async () => {
    reconcile.mockResolvedValue({ status: "pending" });
    const response = await GET(new NextRequest("http://localhost/api/linepay/cancel?orderId=order-1"));
    expect(response.headers.get("location")).toContain("linepay=cancelled");
  });
});
