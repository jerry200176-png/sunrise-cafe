import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REFUND_REFERENCE_PATTERNS, manualRefundProblem, refundActionsFor, refundReferenceValid } from "@/lib/refund-actions";

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
    expect(refundActionsFor({ method: "cash", status: "succeeded" })).toEqual([]);
    expect(refundActionsFor({ method: "cash", status: "failed" })).toEqual([]);
    expect(refundActionsFor({ method: "cash", status: "canceled" })).toEqual([]);
  });
});

describe("manualRefundProblem (Founder D7)", () => {
  const base = { method: "transfer", from: "pending" };
  it("needs a reference and a note to mark a non-cash refund succeeded", () => {
    expect(manualRefundProblem({ ...base, to: "succeeded" })).toBe("refund_evidence_required");
    expect(manualRefundProblem({ ...base, to: "succeeded", note: "已轉" })).toBe("refund_evidence_required");
    expect(manualRefundProblem({ ...base, to: "succeeded", reference: "TX20261015001" })).toBe("refund_evidence_required");
    expect(manualRefundProblem({ ...base, to: "succeeded", note: " ", reference: "TX20261015001" })).toBe("refund_evidence_required");
    expect(manualRefundProblem({ ...base, to: "succeeded", note: "已轉", reference: "TX" })).toBe("invalid_refund_reference");
    expect(manualRefundProblem({ ...base, to: "succeeded", note: "已轉", reference: "TX20261015001" })).toBeNull();
  });
  it("needs a note and the hand-back confirmation (not a bank reference) for a cash refund (A6-3)", () => {
    expect(manualRefundProblem({ method: "cash", from: "requested", to: "succeeded" })).toBe("refund_evidence_required");
    expect(manualRefundProblem({ method: "cash", from: "requested", to: "succeeded", note: "當面交付" })).toBe("cash_handback_required");
    expect(manualRefundProblem({ method: "cash", from: "requested", to: "succeeded", note: "當面交付", cashHandedBack: true })).toBeNull();
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
    expect(manualRefundProblem({ method: "cash", from: "succeeded", to: "failed", note: "x", reference: "TX20261015001" }))
      .toBe("invalid_refund_transition");
  });
  it("A6-9: succeeded → failed needs a valid reference of the bounce plus a reason", () => {
    const from = { method: "transfer", from: "succeeded", to: "failed" };
    expect(manualRefundProblem({ ...from, note: "銀行退回" })).toBe("refund_failure_evidence_required");
    expect(manualRefundProblem({ ...from, note: "銀行退回", reference: "退回" })).toBe("refund_failure_evidence_required");
    expect(manualRefundProblem({ ...from, reference: "RT20261016001" })).toBe("refund_reason_required");
    expect(manualRefundProblem({ ...from, note: "銀行退回", reference: "RT20261016001" })).toBeNull();
  });
});

describe("refund reference formats (Founder A6-8)", () => {
  it.each([
    ["transfer", ["TX20261015001", "123456", "0012-3456-7890"], ["TX-77", "已轉帳", "abcdefgh", "TX 2026101500", ""]],
    ["line_pay", ["2026101500000000001"], ["202610150000000001", "20261015000000000012", "LP2026101500000001"]],
    ["card", ["A1B2C3", "123456789012"], ["A1B2C", "12345678901", "A1B2C3D"]],
    ["other", ["JKOPAY:20261015001", "PI:abc-123"], ["街口退款", "JKOPAY20261015001", "J:12345678"]],
    ["cash", [], ["anything", "123456"]],
    ["stripe", [], ["re_123456789"]],
  ])("%s", (method, good, bad) => {
    for (const ref of good) expect(refundReferenceValid(method, ref)).toBe(true);
    for (const ref of bad) expect(refundReferenceValid(method, ref)).toBe(false);
  });

  it("uses exactly the patterns the SQL function refund_reference_valid uses (read from the migration)", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migration-reservation-settlements.sql"), "utf8");
    const fn = sql.slice(sql.indexOf("FUNCTION public.refund_reference_valid"), sql.indexOf("$$;", sql.indexOf("FUNCTION public.refund_reference_valid")));
    const fromSql = Object.fromEntries([...fn.matchAll(/WHEN '([a-z_]+)' THEN p_ref ~ '([^']+)'/g)].map((m) => [m[1], m[2]]));
    expect(Object.keys(fromSql).length).toBeGreaterThan(0);
    expect(fromSql).toEqual(REFUND_REFERENCE_PATTERNS);
  });
});
