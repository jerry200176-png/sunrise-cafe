import { describe, expect, it } from "vitest";
import {
  buildCeoEvidence,
  confidenceForAccess,
  rateWithDenominator,
  resolveOutcomeAccess,
} from "./ceo-evidence-contract";

describe("outcome access distinctions", () => {
  it("separates unauthorized from zero activity", () => {
    expect(
      resolveOutcomeAccess({
        authorized: false,
        collected: false,
        freshness_hours: null,
        booking_started: null,
      })
    ).toBe("unauthorized");
    expect(
      resolveOutcomeAccess({
        authorized: true,
        collected: true,
        freshness_hours: 1,
        booking_started: 0,
      })
    ).toBe("zero_activity");
  });

  it("marks stale when evidence older than threshold", () => {
    expect(
      resolveOutcomeAccess({
        authorized: true,
        collected: true,
        freshness_hours: 48,
        booking_started: 12,
      })
    ).toBe("stale");
  });

  it("does not invent rates when denominator is zero", () => {
    expect(rateWithDenominator(0, 0)).toBeNull();
    expect(rateWithDenominator(3, 10)).toBe(0.3);
  });

  it("gives high confidence for zero_activity and ok live counts", () => {
    expect(confidenceForAccess("zero_activity", true)).toBe("high");
    expect(confidenceForAccess("ok", true)).toBe("high");
    expect(confidenceForAccess("unauthorized", false)).toBe("low");
  });

  it("buildCeoEvidence never treats unauthorized as zero bookings", () => {
    const c = buildCeoEvidence({
      sha: "abc",
      verified: true,
      health_ok: true,
      authorized: false,
      collected: false,
      outcomes: {},
    });
    expect(c.outcome_access).toBe("unauthorized");
    expect(c.outcomes.booking_started).toBeNull();
    expect(c.evidence_confidence).toBe("low");
    expect(c.risks).toContain("outcome_access_unauthorized");
  });

  it("buildCeoEvidence marks zero_activity when booking_started is 0", () => {
    const c = buildCeoEvidence({
      sha: "abc",
      verified: true,
      health_ok: true,
      authorized: true,
      collected: true,
      outcomes: {
        booking_started: 0,
        booking_completed: 0,
        deposit_required: 0,
        deposit_completed: 0,
        outcome_data_freshness: new Date().toISOString(),
      },
    });
    expect(c.outcome_access).toBe("zero_activity");
    expect(c.evidence_confidence).toBe("high");
  });
});
