import { describe, expect, it } from "vitest";
import { manualRefundProblem, refundActionsFor } from "@/lib/refund-actions";

describe("refundActionsFor (Founder D7)", () => {
  it("gives a Stripe refund only reconcile while open, and nothing once finished", () => {
    expect(refundActionsFor({ method: "stripe", status: "requested" })).toEqual(["reconcile"]);
    expect(refundActionsFor({ method: "stripe", status: "pending" })).toEqual(["reconcile"]);
    for (const status of ["succeeded", "failed", "canceled"]) expect(refundActionsFor({ method: "stripe", status })).toEqual([]);
  });
  it("gives a manual refund confirm / fail / cancel while open", () => {
    expect(refundActionsFor({ method: "transfer", status: "requested" })).toEqual(["pending", "confirm", "fail", "cancel"]);
    expect(refundActionsFor({ method: "transfer", status: "pending" })).toEqual(["confirm", "fail", "cancel"]);
    expect(refundActionsFor({ method: "transfer", status: "succeeded" })).toEqual(["fail"]);
    expect(refundActionsFor({ method: "cash", status: "failed" })).toEqual([]);
    expect(refundActionsFor({ method: "cash", status: "canceled" })).toEqual([]);
  });
});

describe("manualRefundProblem (Founder D7)", () => {
  const base = { method: "transfer", from: "pending" };
  it("needs a reference and a note to mark a non-cash refund succeeded", () => {
    expect(manualRefundProblem({ ...base, to: "succeeded" })).toBe("refund_evidence_required");
    expect(manualRefundProblem({ ...base, to: "succeeded", note: "已轉" })).toBe("refund_evidence_required");
    expect(manualRefundProblem({ ...base, to: "succeeded", reference: "TX" })).toBe("refund_evidence_required");
    expect(manualRefundProblem({ ...base, to: "succeeded", note: " ", reference: "TX" })).toBe("refund_evidence_required");
    expect(manualRefundProblem({ ...base, to: "succeeded", note: "已轉", reference: "TX" })).toBeNull();
  });
  it("needs a note (not a bank reference) for a cash refund", () => {
    expect(manualRefundProblem({ method: "cash", from: "requested", to: "succeeded" })).toBe("refund_evidence_required");
    expect(manualRefundProblem({ method: "cash", from: "requested", to: "succeeded", note: "當面交付" })).toBeNull();
  });
  it.each(["failed", "canceled"])("needs a reason to mark %s", (to) => {
    expect(manualRefundProblem({ ...base, to })).toBe("refund_reason_required");
    expect(manualRefundProblem({ ...base, to, note: "客人改要留抵" })).toBeNull();
  });
  it("never lets a person set a Stripe outcome", () => {
    for (const to of ["succeeded", "failed", "canceled", "pending"]) {
      expect(manualRefundProblem({ method: "stripe", from: "requested", to, note: "x", reference: "re_1" })).toBe("provider_outcome_only");
    }
  });
  it("refuses transitions the ledger does not allow", () => {
    expect(manualRefundProblem({ method: "transfer", from: "canceled", to: "succeeded", note: "x", reference: "TX" })).toBe("invalid_refund_transition");
    expect(manualRefundProblem({ method: "transfer", from: "succeeded", to: "canceled", note: "x" })).toBe("invalid_refund_transition");
    expect(manualRefundProblem({ method: "transfer", from: "pending", to: "requested" })).toBe("invalid_refund_transition");
    expect(manualRefundProblem({ method: "transfer", from: "succeeded", to: "failed", note: "銀行退回" })).toBeNull();
  });
});
