import { describe, it, expect } from "vitest";
import { buildLineImagePayload, parseLineImageMessageId } from "./payment-event-payload";

describe("payment-event-payload", () => {
  it("round-trips line image message id", () => {
    const raw = buildLineImagePayload("msg-abc-123");
    expect(parseLineImageMessageId(raw)).toBe("msg-abc-123");
  });

  it("returns null for plain text payload", () => {
    expect(parseLineImageMessageId("已匯款")).toBeNull();
    expect(parseLineImageMessageId(null)).toBeNull();
  });
});
