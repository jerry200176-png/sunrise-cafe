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
      expect(c.truth_source).toBeTruthy();
      expect(c.reconciliation).toBeTruthy();
    }
  });

  it("marks null observed as incomplete", () => {
    const r = evaluateContractCompleteness({
      id: "deposit_conversion",
      observed: null,
      denominator_n: 10,
    });
    expect(r.contract_satisfied).toBe(false);
    expect(r.gaps).toContain("observed_null");
  });
});
