import { describe, it, expect } from "vitest";
import {
  isAnalyticsEventName,
  sanitizeAnalyticsProperties,
} from "./analytics-events";

describe("isAnalyticsEventName", () => {
  it("accepts known events", () => {
    expect(isAnalyticsEventName("booking_completed")).toBe(true);
  });

  it("rejects unknown events", () => {
    expect(isAnalyticsEventName("phone_leaked")).toBe(false);
  });
});

describe("sanitizeAnalyticsProperties", () => {
  it("keeps allowed keys only", () => {
    expect(
      sanitizeAnalyticsProperties({
        branch_id: "uuid",
        phone: "0912345678",
        duration_hours: 2,
      })
    ).toEqual({ branch_id: "uuid", duration_hours: 2 });
  });

  it("strips PII-like fields", () => {
    expect(
      sanitizeAnalyticsProperties({
        customer_name: "Alice",
        email: "a@b.com",
      })
    ).toEqual({});
  });
});
