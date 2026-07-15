import { describe, expect, it } from "vitest";
import {
  evaluateContractCompleteness,
  NORTH_STAR_CONTRACTS,
} from "./north-star-contracts";
import { NORTH_STAR_TARGETS } from "./north-star-targets";

describe("NORTH_STAR_CONTRACTS", () => {
  it("covers every target metric with required fields", () => {
    for (const id of Object.keys(NORTH_STAR_TARGETS) as (keyof typeof NORTH_STAR_TARGETS)[]) {
      const c = NORTH_STAR_CONTRACTS[id];
      expect(c.id).toBe(id);
      expect(c.numerator.length).toBeGreaterThan(5);
      expect(c.denominator.length).toBeGreaterThan(1);
      expect(c.timezone).toBeTruthy();
      expect(c.window).toBeTruthy();
      expect(c.freshness_sla).toBeTruthy();
      expect(c.completeness_rule).toBeTruthy();
      expect(c.min_denominator_n).toBeGreaterThan(0);
      expect(c.truth_source).toBeTruthy();
      expect(c.reconciliation).toBeTruthy();
    }
  });

  it("never satisfies on observed != null alone", () => {
    const r = evaluateContractCompleteness({
      id: "deposit_conversion",
      observed: 0.5,
      denominator_n: null,
      table_ready: true,
      source_fresh_at: new Date().toISOString(),
      reconciliation_delta: 0,
    });
    expect(r.contract_satisfied).toBe(false);
    expect(r.a_grade_eligible).toBe(false);
    expect(r.gaps).toContain("denominator_unmeasured");
  });

  it("marks null observed as incomplete", () => {
    const r = evaluateContractCompleteness({
      id: "deposit_conversion",
      observed: null,
      denominator_n: 10,
      table_ready: true,
      source_fresh_at: new Date().toISOString(),
      reconciliation_delta: 0,
    });
    expect(r.contract_satisfied).toBe(false);
    expect(r.gaps).toContain("observed_null");
  });

  it("fails insufficient_n and emits alert", () => {
    const r = evaluateContractCompleteness({
      id: "booking_conversion",
      observed: 0.4,
      denominator_n: 5,
      table_ready: true,
      source_fresh_at: new Date().toISOString(),
      reconciliation_delta: 0,
    });
    expect(r.gaps).toContain("insufficient_n");
    expect(r.alerts.length).toBeGreaterThan(0);
    expect(r.contract_satisfied).toBe(false);
  });

  it("fails stale freshness", () => {
    const r = evaluateContractCompleteness({
      id: "booking_conversion",
      observed: 0.4,
      denominator_n: 25,
      table_ready: true,
      source_fresh_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      reconciliation_delta: 0,
      now: new Date(),
    });
    expect(r.gaps).toContain("stale");
  });

  it("satisfies when all gates pass", () => {
    const r = evaluateContractCompleteness({
      id: "booking_conversion",
      observed: 0.4,
      denominator_n: 25,
      table_ready: true,
      source_fresh_at: new Date().toISOString(),
      reconciliation_delta: 0,
      duplicate_rate: 0,
    });
    expect(r.gaps).toEqual([]);
    expect(r.contract_satisfied).toBe(true);
    expect(r.a_grade_eligible).toBe(true);
  });
});
