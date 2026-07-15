import { describe, expect, it } from "vitest";
import { opsEventIdempotencyKey } from "./ops-log";

describe("opsEventIdempotencyKey", () => {
  it("accepts bounded string keys", () => {
    expect(opsEventIdempotencyKey({ idempotency_key: "session-abc-123" })).toBe("session-abc-123");
  });

  it("rejects short or non-string", () => {
    expect(opsEventIdempotencyKey({ idempotency_key: "short" })).toBeNull();
    expect(opsEventIdempotencyKey({})).toBeNull();
  });
});
