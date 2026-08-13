import { describe, expect, it } from "vitest";
import { providerPaymentMatches, safeLinePayError } from "./linepay-lifecycle";

describe("LINE Pay reconciliation guards", () => {
  it("requires matching order, transaction, and amount evidence", () => {
    const expected = { orderId: "order-1", transactionId: "tx-1", amount: 300, requireAmount: true };
    expect(providerPaymentMatches({ returnCode: "0000", info: { orderId: "order-1", transactionId: "tx-1", payInfo: [{ amount: 300 }] } }, expected)).toBe(true);
    expect(providerPaymentMatches({ returnCode: "0000", info: { orderId: "other", transactionId: "tx-1", amount: 300 } }, expected)).toBe(false);
    expect(providerPaymentMatches({ returnCode: "0000", info: { orderId: "order-1", transactionId: "tx-1", amount: 301 } }, expected)).toBe(false);
  });

  it("redacts bearer-style values from retry audit errors", () => {
    expect(safeLinePayError(new Error("Bearer secret authorization=hidden\nprovider timeout"))).toBe("Bearer [redacted] authorization=[redacted] provider timeout");
  });
});
