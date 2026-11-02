import { describe, expect, it } from "vitest";
import { evaluateGuestCancel } from "./cancel-refund-policy";

const start = Date.parse("2026-07-20T04:00:00.000Z"); // 12:00 TW

describe("evaluateGuestCancel", () => {
  it("allows unpaid cancel when outside 24h", () => {
    const r = evaluateGuestCancel({
      isDepositPaid: false,
      startTimeMs: start,
      nowMs: start - 48 * 3600_000,
    });
    expect(r.allowed).toBe(true);
    expect(r.eligibility).toBe("self_cancel_free");
  });

  it("blocks unpaid cancel inside 24h", () => {
    const r = evaluateGuestCancel({
      isDepositPaid: false,
      startTimeMs: start,
      nowMs: start - 12 * 3600_000,
    });
    expect(r.allowed).toBe(false);
    expect(r.eligibility).toBe("locked_contact_store");
  });

  it("never auto-allows paid deposit cancel; requires staff path", () => {
    const r = evaluateGuestCancel({
      isDepositPaid: true,
      startTimeMs: start,
      nowMs: start - 72 * 3600_000,
    });
    expect(r.allowed).toBe(false);
    expect(r.eligibility).toBe("staff_review_required");
    expect(r.message).toMatch(/審核|來電|申請/);
  });

  it("requires contact on either side of the paid 48-hour boundary", () => {
    const boundary = evaluateGuestCancel({ isDepositPaid: true, startTimeMs: start, nowMs: start - 48 * 3600_000 });
    const inside = evaluateGuestCancel({ isDepositPaid: true, startTimeMs: start, nowMs: start - 48 * 3600_000 + 1 });
    expect(boundary).toMatchObject({ allowed: false, eligibility: "staff_review_required" });
    expect(inside).toMatchObject({ allowed: false, eligibility: "locked_contact_store" });
    for (const result of [boundary, inside]) {
      expect(result.message).toContain("48 小時");
      expect(result.message).toContain("來電");
      expect(result.message).toContain("LINE");
      expect(result.message).toContain("非自動退款");
      expect(result.message).not.toContain("透過查詢頁提出");
    }
  });
});
