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

  it("bank-transfer approval copies the reported last five and Taipei report date onto the reservation", async () => {
    const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
    mocks.from.mockImplementation((table: string) =>
      table === "reservations"
        ? { update }
        : {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "event-1",
                    reservation_id: "reservation-1",
                    source: "bank_transfer",
                    status: "pending_review",
                    raw_payload: "customer_portal_transfer_report",
                    reported_account_last_five: "54321",
                    reported_at: "2026-09-28T17:30:00Z", // 台北 09/29 01:30
                  },
                  error: null,
                }),
              }),
            }),
          }
    );
    mocks.rpc.mockResolvedValue({
      data: [{ reservation_id: "reservation-1", outcome: "confirmed", reservation_status: "confirmed" }],
      error: null,
    });

    await expect(approvePaymentEvent("event-1")).resolves.toEqual({ already_processed: false });
    expect(update).toHaveBeenCalledWith({ deposit_last_five: "54321", deposit_paid_on: "2026-09-29" });
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

  it("wins the payment-event approval transition before marking the reservation paid", async () => {
    const operations: string[] = [];
    mocks.from.mockImplementation((table: string) => {
      if (table === "payment_events") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "event-2",
                  reservation_id: "reservation-2",
                  source: "line_image",
                  status: "pending_review",
                  raw_payload: "付款截圖",
                },
                error: null,
              }),
            }),
          }),
          update: () => {
            operations.push("payment_event_approved");
            const chain = {
              eq: () => chain,
              select: () => chain,
              maybeSingle: async () => ({ data: { id: "event-2" }, error: null }),
            };
            return chain;
          },
        };
      }

      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                is_deposit_paid: false,
                deposit_payment_note: null,
                status: "confirmed",
                booking_code: "ABC123",
              },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: async () => {
            operations.push("reservation_marked_paid");
            return { error: null };
          },
        }),
      };
    });

    await expect(approvePaymentEvent("event-2", "已確認入帳", "operator-2"))
      .resolves.toEqual({ already_processed: false });
    expect(operations).toEqual(["payment_event_approved", "reservation_marked_paid"]);
  });

  it("does not mark a reservation paid when another reviewer wins the event transition", async () => {
    const operations: string[] = [];
    mocks.from.mockImplementation((table: string) => {
      if (table === "payment_events") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "event-3",
                  reservation_id: "reservation-3",
                  source: "line_image",
                  status: "pending_review",
                  raw_payload: "付款截圖",
                },
                error: null,
              }),
            }),
          }),
          update: () => {
            operations.push("payment_event_cas");
            const chain = {
              eq: () => chain,
              select: () => chain,
              maybeSingle: async () => ({ data: null, error: null }),
            };
            return chain;
          },
        };
      }

      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                is_deposit_paid: false,
                deposit_payment_note: null,
                status: "confirmed",
                booking_code: "ABC123",
              },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: async () => {
            operations.push("reservation_marked_paid");
            return { error: null };
          },
        }),
      };
    });

    await expect(approvePaymentEvent("event-3", "已確認入帳", "operator-3"))
      .resolves.toEqual({ already_processed: true });
    expect(operations).toEqual(["payment_event_cas"]);
  });
});
