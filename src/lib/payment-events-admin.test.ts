import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  markDepositPaid: vi.fn(),
}));

// The paid-state write, audit and notification are tested through the deposit-paid interface.
vi.mock("@/lib/deposit-paid", () => ({ markDepositPaid: mocks.markDepositPaid }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: mocks.from, rpc: mocks.rpc })),
}));

vi.mock("@/lib/payment-log", () => ({
  logPayment: vi.fn(),
  logDepositStatusChange: vi.fn(),
}));

import { approvePaymentEvent } from "@/lib/payment-events-admin";

beforeEach(() => {
  mocks.markDepositPaid.mockReset();
  mocks.markDepositPaid.mockResolvedValue({ changed: true, notification: null });
});

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
      .resolves.toEqual({ already_processed: false, notification: null });
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_bank_transfer_payment", {
      p_event_id: "event-1",
      p_actor: "operator-1",
      p_review_note: "已核對銀行入帳",
    });
  });

  it("bank-transfer approval copies the reported last five and Taipei report date onto the reservation", async () => {
    mocks.from.mockImplementation((table: string) =>
      table === "reservations"
        ? {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: "reservation-1", status: "confirmed", end_time: "2999-01-01T00:00:00Z", total_price: 1000, is_deposit_paid: false },
                  error: null,
                }),
              }),
            }),
          }
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

    await expect(approvePaymentEvent("event-1")).resolves.toEqual({ already_processed: false, notification: null });
    expect(mocks.markDepositPaid).toHaveBeenCalledWith(
      "reservation-1",
      "payment_review",
      expect.objectContaining({ lastFive: "54321", paidOn: "2026-09-29", paymentEventId: "event-1" }),
      "admin_payment_review"
    );
  });

  describe("reservation already ended (late confirmation)", () => {
    function lateWorld(reservation: Record<string, unknown>, event: Record<string, unknown> = {}) {
      const updates: Record<string, unknown>[] = [];
      const single = (data: unknown) => ({ select: () => ({ eq: () => ({ single: async () => ({ data, error: null }) }) }) });
      mocks.rpc.mockReset();
      mocks.from.mockImplementation((table: string) =>
        table === "reservations"
          ? single({ id: "reservation-9", status: "completed", end_time: "2026-10-09T07:30:00Z", total_price: 1000, is_deposit_paid: false, ...reservation })
          : {
              ...single({
                id: "event-9", reservation_id: "reservation-9", source: "bank_transfer", status: "pending_review",
                raw_payload: "customer_portal_transfer_report", reported_account_last_five: "12345",
                reported_amount: 500, reported_at: "2026-10-07T08:28:00Z", ...event,
              }),
              update: (patch: Record<string, unknown>) => {
                updates.push(patch);
                const chain = { eq: () => chain, select: () => chain, maybeSingle: async () => ({ data: { id: "event-9" }, error: null }) };
                return chain;
              },
            }
      );
      return updates;
    }

    it("records a completed bank transfer without the RPC and without notifying the guest", async () => {
      const updates = lateWorld({});
      await expect(approvePaymentEvent("event-9", null, "operator-9"))
        .resolves.toEqual({ already_processed: false, notification: null, ended: true });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(updates).toEqual([expect.objectContaining({ status: "approved", reviewed_by: "operator-9" })]);
      expect(mocks.markDepositPaid).toHaveBeenCalledWith(
        "reservation-9",
        "payment_review",
        expect.objectContaining({ skipNotify: true, lastFive: "12345", paidOn: "2026-10-07", paymentEventId: "event-9" }),
        "operator-9"
      );
    });

    it("a confirmed reservation whose end time has passed counts as ended", async () => {
      lateWorld({ status: "confirmed" }, { source: "line_text", raw_payload: "晚點匯款" });
      await expect(approvePaymentEvent("event-9")).resolves.toMatchObject({ ended: true });
      expect(mocks.markDepositPaid.mock.calls[0][2]).toMatchObject({ skipNotify: true });
    });

    it.each([
      ["amount differs from the expected deposit", {}, { reported_amount: 400 }, "匯款回報資料與應收訂金不符"],
      ["last five is malformed", {}, { reported_account_last_five: "1234" }, "匯款回報資料與應收訂金不符"],
      ["deposit is already confirmed", { is_deposit_paid: true }, {}, "此訂位訂金已確認"],
    ])("refuses a late bank transfer when %s", async (_name, reservation, event, message) => {
      const updates = lateWorld(reservation, event);
      await expect(approvePaymentEvent("event-9")).rejects.toThrow(message);
      expect(updates).toEqual([]);
      expect(mocks.markDepositPaid).not.toHaveBeenCalled();
    });

    it("a cancelled reservation still goes to the RPC, which refuses it", async () => {
      lateWorld({ status: "cancelled" });
      mocks.rpc.mockResolvedValue({ data: null, error: { message: "訂位已取消、完成或過期，無法確認匯款" } });
      await expect(approvePaymentEvent("event-9")).rejects.toThrow("訂位已取消");
      expect(mocks.markDepositPaid).not.toHaveBeenCalled();
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

    mocks.markDepositPaid.mockImplementation(async () => {
      operations.push("reservation_marked_paid");
      return { changed: true, notification: null };
    });
    await expect(approvePaymentEvent("event-2", "已確認入帳", "operator-2"))
      .resolves.toEqual({ already_processed: false, notification: null });
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
