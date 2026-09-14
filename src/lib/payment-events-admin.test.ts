import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: mocks.from, rpc: mocks.rpc })),
}));

vi.mock("@/lib/payment-log", () => ({
  logPayment: vi.fn(),
  logDepositStatusChange: vi.fn(),
}));

import { approvePaymentEvent } from "@/lib/payment-events-admin";

/**
 * 審核狀態轉換規則（與 payment-events-admin 邏輯對齊，純函式供測試）
 */
export function resolveApproveAction(
  currentStatus: string
): "approve" | "noop" | "conflict" {
  if (currentStatus === "approved") return "noop";
  if (currentStatus === "pending_review") return "approve";
  return "conflict";
}

export function resolveRejectAction(
  currentStatus: string
): "reject" | "noop" | "conflict" {
  if (currentStatus === "rejected") return "noop";
  if (currentStatus === "pending_review") return "reject";
  return "conflict";
}

describe("payment review idempotency rules", () => {
  it("approve on approved is noop", () => {
    expect(resolveApproveAction("approved")).toBe("noop");
  });

  it("approve on pending_review proceeds", () => {
    expect(resolveApproveAction("pending_review")).toBe("approve");
  });

  it("approve on rejected is conflict", () => {
    expect(resolveApproveAction("rejected")).toBe("conflict");
  });

  it("reject on rejected is noop", () => {
    expect(resolveRejectAction("rejected")).toBe("noop");
  });

  it("reject on pending_review proceeds", () => {
    expect(resolveRejectAction("pending_review")).toBe("reject");
  });

  it("reject on approved is conflict", () => {
    expect(resolveRejectAction("approved")).toBe("conflict");
  });

  it("bank-transfer approval delegates to the atomic confirmation RPC", async () => {
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: "event-1",
              reservation_id: "reservation-1",
              source: "bank_transfer",
              status: "pending_review",
              raw_payload: "customer_portal_transfer_report",
            },
            error: null,
          }),
        }),
      }),
    });
    mocks.rpc.mockResolvedValue({
      data: [{
        payment_event_id: "event-1",
        reservation_id: "reservation-1",
        outcome: "confirmed",
        reservation_status: "confirmed",
      }],
      error: null,
    });

    await expect(approvePaymentEvent("event-1", "已核對銀行入帳", "operator-1"))
      .resolves.toEqual({ already_processed: false });
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_bank_transfer_payment", {
      p_event_id: "event-1",
      p_actor: "operator-1",
      p_review_note: "已核對銀行入帳",
    });
  });

  it("already-processed confirmation is a no-op for notification callers", async () => {
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: "event-1",
              reservation_id: "reservation-1",
              source: "bank_transfer",
              status: "pending_review",
              raw_payload: "customer_portal_transfer_report",
            },
            error: null,
          }),
        }),
      }),
    });
    mocks.rpc.mockResolvedValue({
      data: [{ outcome: "already_processed", reservation_id: "reservation-1" }],
      error: null,
    });

    await expect(approvePaymentEvent("event-1")).resolves.toEqual({ already_processed: true });
  });
});
