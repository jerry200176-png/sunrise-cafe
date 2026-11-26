import { describe, it, expect } from "vitest";
import { buildLineImagePayload, parseLineImageMessageId, paymentNoteLabel } from "./payment-event-payload";

describe("payment-event-payload", () => {
  it("round-trips line image message id", () => {
    const raw = buildLineImagePayload("msg-abc-123");
    expect(parseLineImageMessageId(raw)).toBe("msg-abc-123");
  });

  it("returns null for plain text payload", () => {
    expect(parseLineImageMessageId("已匯款")).toBeNull();
    expect(parseLineImageMessageId(null)).toBeNull();
  });

  it("shows a stored LINE image id as the source label, never raw JSON", () => {
    expect(paymentNoteLabel(buildLineImagePayload("100000000000000001"))).toBe("LINE 截圖");
  });

  it("keeps staff and guest text notes as written", () => {
    expect(paymentNoteLabel(" 現場現金 ")).toBe("現場現金");
    expect(paymentNoteLabel("")).toBeNull();
    expect(paymentNoteLabel(null)).toBeNull();
  });
});
