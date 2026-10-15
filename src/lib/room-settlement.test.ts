import { describe, expect, it } from "vitest";
import { MAX_CASH_TENDERED, canAdjustMoney, cashChange, cashChangeMessage, moneyActor, settlementFailure, stripeRefundStatus, summarizeDepositRefunds } from "@/lib/room-settlement";
import { isDepositFullyRefunded } from "@/lib/refund-ledger";

describe("refund principle 2 — who may move money", () => {
  it.each([
    ["owner", true, null, true],
    ["owner", true, ["b1"], true],
    ["branch_manager", true, ["b1"], true],
    ["branch_manager", false, ["b2"], false],
    ["branch_manager", true, null, false],
    ["staff", true, ["b1"], false],
    ["finance", true, null, false],
    ["none", true, null, false],
    [null, true, null, false],
  ] as const)("%s with branch access %s and branches %j → %s", (role, access, branches, expected) => {
    expect(canAdjustMoney(role, access, branches as string[] | null)).toBe(expected);
  });

  it("builds the SQL actor only from the session context", () => {
    expect(moneyActor({ user_id: "mgr-1", role: "branch_manager", branch_ids: ["b1"] }))
      .toEqual({ p_actor: "mgr-1", p_actor_role: "branch_manager", p_actor_branch_ids: ["b1"] });
    expect(moneyActor({ user_id: null, role: "owner", branch_ids: null }))
      .toEqual({ p_actor: "owner", p_actor_role: "owner", p_actor_branch_ids: null });
  });
});

describe("refund principles 3 & 4 — what counts as refunded", () => {
  it("counts only succeeded deposit refunds, and only their amounts (partial refunds)", () => {
    expect(summarizeDepositRefunds([
      { kind: "deposit", amount: 80, status: "succeeded" },
      { kind: "deposit", amount: 20, status: "succeeded" },
      { kind: "deposit", amount: 50, status: "failed" },
      { kind: "deposit", amount: 30, status: "canceled" },
      { kind: "checkout_deposit_excess", amount: 100, status: "succeeded" },
    ], "paid")).toEqual({ refunded: 100, inFlight: false });
  });

  it.each(["requested", "pending"])("treats a %s refund as not refunded but in flight", (status) => {
    expect(summarizeDepositRefunds([{ kind: "deposit", amount: 200, status }], "paid")).toEqual({ refunded: 0, inFlight: true });
  });

  it("uses the ledger, not deposit_status, once the ledger has a deposit refund", () => {
    expect(summarizeDepositRefunds([{ kind: "deposit", amount: 200, status: "failed" }], "refunded"))
      .toEqual({ refunded: 0, inFlight: false });
  });

  it("treats a legacy deposit_status=refunded (no ledger rows) as fully refunded", () => {
    expect(summarizeDepositRefunds([], "refunded").refunded).toBe(Number.POSITIVE_INFINITY);
    expect(summarizeDepositRefunds(null, "refunded").refunded).toBe(Number.POSITIVE_INFINITY);
    expect(summarizeDepositRefunds(null, "paid")).toEqual({ refunded: 0, inFlight: false });
  });

  it.each([
    ["succeeded", "succeeded"], ["failed", "failed"], ["canceled", "canceled"],
    ["pending", "pending"], ["requires_action", "pending"], [undefined, "pending"], ["something_new", "pending"],
  ])("maps Stripe refund status %s to %s (unknown is never refunded)", (stripe, ledger) => {
    expect(stripeRefundStatus(stripe)).toBe(ledger);
  });

  it("only calls a deposit fully refunded when succeeded refunds cover it", () => {
    expect(isDepositFullyRefunded({ deposit_gross: 200, deposit_refunded: 200 })).toBe(true);
    expect(isDepositFullyRefunded({ deposit_gross: 200, deposit_refunded: 120 })).toBe(false);
    expect(isDepositFullyRefunded({ deposit_gross: 0, deposit_refunded: 0 })).toBe(false);
  });
});

describe("settlementFailure — refund codes from the SQL", () => {
  it.each([
    ["refund_in_flight", 409], ["nothing_to_refund", 409], ["refund_exceeds_refundable", 409], ["idempotency_conflict", 409],
    ["invalid_refund_transition", 409], ["provider_outcome_only", 409], ["refund_not_allowed", 409],
    ["refund_ledger_append_only", 409], ["refund_not_found", 404], ["reservation_not_found", 404],
  ])("maps %s to a readable %i", (code, status) => {
    const mapped = settlementFailure({ code: "P0001", message: code });
    expect(mapped?.status).toBe(status);
    expect(mapped?.error).not.toBe(code);
  });
});

describe("cashChange (Founder D6)", () => {
  it("is tendered minus collected for a cash checkout that collects money", () => {
    expect(cashChange({ tendered: 1000, method: "cash", collected: 560, refund: 0 })).toEqual({ change: 440 });
    expect(cashChange({ tendered: 560, method: "cash", collected: 560, refund: 0 })).toEqual({ change: 0 });
  });
  it("accepts exactly the maximum", () => {
    expect(cashChange({ tendered: MAX_CASH_TENDERED, method: "cash", collected: 560, refund: 0 })).toEqual({ change: MAX_CASH_TENDERED - 560 });
  });
  it("records nothing when no tendered amount is given", () => {
    expect(cashChange({ tendered: undefined, method: "card", collected: 560, refund: 0 })).toEqual({ change: null });
    expect(cashChange({ tendered: undefined, method: "cash", collected: 0, refund: 0 })).toEqual({ change: null });
    expect(cashChange({ tendered: null, method: "cash", collected: 0, refund: 150 })).toEqual({ change: null });
  });
  it("requires the tendered amount for a cash checkout that collects money (Founder A6-7)", () => {
    expect(cashChange({ tendered: undefined, method: "cash", collected: 560, refund: 0 })).toEqual({ problem: "cash_tendered_required" });
    expect(cashChange({ tendered: null, method: "cash", collected: 1, refund: 0 })).toEqual({ problem: "cash_tendered_required" });
  });
  it.each([
    [{ tendered: 1000, method: "card", collected: 560, refund: 0 }, "change_cash_only"],
    [{ tendered: 1000, method: "line_pay", collected: 560, refund: 0 }, "change_cash_only"],
    [{ tendered: 150, method: "cash", collected: 0, refund: 150 }, "change_not_refund"],
    [{ tendered: 100, method: "cash", collected: 0, refund: 0 }, "change_not_refund"],
    [{ tendered: 500, method: "cash", collected: 560, refund: 0 }, "cash_tendered_short"],
    [{ tendered: 0, method: "cash", collected: 560, refund: 0 }, "invalid_cash_tendered"],
    [{ tendered: 600.5, method: "cash", collected: 560, refund: 0 }, "invalid_cash_tendered"],
    [{ tendered: "1000", method: "cash", collected: 560, refund: 0 }, "invalid_cash_tendered"],
    [{ tendered: 100_001, method: "cash", collected: 560, refund: 0 }, "invalid_cash_tendered"],
    [{ tendered: 2 ** 31, method: "cash", collected: 560, refund: 0 }, "invalid_cash_tendered"],
    [{ tendered: Number.MAX_SAFE_INTEGER + 2, method: "cash", collected: 560, refund: 0 }, "invalid_cash_tendered"],
  ])("refuses %o with %s", (input, problem) => {
    expect(cashChange(input)).toEqual({ problem });
  });
  it("has a Chinese message for every problem", () => {
    for (const problem of ["invalid_cash_tendered", "change_cash_only", "change_not_refund", "cash_tendered_short", "cash_tendered_required"] as const) {
      expect(cashChangeMessage(problem)).toMatch(/[\u4e00-\u9fff]/);
      expect(settlementFailure({ message: problem })?.error).toBe(cashChangeMessage(problem));
    }
  });
});
