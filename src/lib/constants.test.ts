import { describe, it, expect } from "vitest";
import { getBranchDepositConfig, BRANCH_DEPOSIT_CONFIG } from "./constants";

describe("getBranchDepositConfig", () => {
  it("returns daan branch config with stripeEnabled true", () => {
    const config = getBranchDepositConfig("daan");
    expect(config.isDepositRequired).toBe(true);
    expect(config.stripeEnabled).toBe(true);
    expect(config.defaultDepositAmount).toBe(500);
  });

  it("returns safe default for unknown branch", () => {
    const config = getBranchDepositConfig("unknown-branch");
    expect(config.isDepositRequired).toBe(false);
    expect(config.stripeEnabled).toBe(false);
    expect(config.defaultDepositAmount).toBe(0);
  });
});

describe("BRANCH_DEPOSIT_CONFIG", () => {
  it("daan is configured", () => {
    expect(BRANCH_DEPOSIT_CONFIG).toHaveProperty("daan");
    expect(BRANCH_DEPOSIT_CONFIG.daan.stripeEnabled).toBe(true);
  });
});
