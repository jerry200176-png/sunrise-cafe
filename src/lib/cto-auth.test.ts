import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isValidCtoBearer } from "@/lib/cto-auth";

function req(auth?: string) {
  return new NextRequest("http://localhost/api/cto/outcomes", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("isValidCtoBearer", () => {
  it("rejects when secret unset", () => {
    const prev = process.env.CTO_OUTCOME_SECRET;
    delete process.env.CTO_OUTCOME_SECRET;
    delete process.env.CRON_SECRET;
    expect(isValidCtoBearer(req("Bearer x"))).toBe(false);
    if (prev) process.env.CTO_OUTCOME_SECRET = prev;
  });

  it("accepts matching CTO_OUTCOME_SECRET", () => {
    process.env.CTO_OUTCOME_SECRET = "test-secret";
    expect(isValidCtoBearer(req("Bearer test-secret"))).toBe(true);
    expect(isValidCtoBearer(req("Bearer wrong"))).toBe(false);
    delete process.env.CTO_OUTCOME_SECRET;
  });
});
