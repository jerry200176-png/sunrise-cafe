import { describe, expect, it } from "vitest";
import { fromStripeAmount, toStripeAmount } from "@/lib/stripe-money";

describe("stripe-money (TWD is a two-decimal currency in Stripe)", () => {
  it("multiplies TWD by 100 going to Stripe and divides coming back", () => {
    expect(toStripeAmount(500)).toBe(50000);
    expect(toStripeAmount(500, "TWD")).toBe(50000);
    expect(fromStripeAmount(50000)).toBe(500);
    expect(fromStripeAmount(toStripeAmount(1234))).toBe(1234);
  });
  it("rounds Stripe sub-units down so a refundable amount is never overstated", () => {
    expect(fromStripeAmount(19999)).toBe(199);
  });
  it("leaves zero-decimal currencies alone", () => {
    expect(toStripeAmount(500, "jpy")).toBe(500);
    expect(fromStripeAmount(500, "jpy")).toBe(500);
  });
  it("refuses fractional or negative dollars", () => {
    expect(() => toStripeAmount(1.5)).toThrow();
    expect(() => toStripeAmount(-1)).toThrow();
  });
});
