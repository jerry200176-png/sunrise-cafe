import { describe, expect, it } from "vitest";
import { createLinePaySignature, parseLinePayJson } from "./line-pay";

describe("LINE Pay API signing", () => {
  it("creates the documented HMAC-SHA256 base64 signature", () => {
    expect(
      createLinePaySignature("secret", "/v4/payments/request", '{"amount":500}', "nonce")
    ).toBe("8H/QeBdNRDa8nXSYUI02oCIut4qXHJBUHG/TF6E49yQ=");
  });

  it("preserves transaction IDs larger than JavaScript safe integers", () => {
    const parsed = parseLinePayJson<{ info: { transactionId: string } }>(
      '{"returnCode":"0000","info":{"transactionId":98765432109876543210}}'
    );
    expect(parsed.info.transactionId).toBe("98765432109876543210");
  });
});
