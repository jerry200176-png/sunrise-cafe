import { describe, expect, it } from "vitest";
import { LineSendError, lineHttpFailure, lineSendFailure } from "./line-send-error";

describe("LINE send outcome", () => {
  it("only calls unambiguous 4xx responses a provider rejection", () => {
    for (const status of [400, 401, 403, 404, 422, 429]) expect(lineHttpFailure(status)).toBe("rejected");
    for (const status of [408, 409, 500, 502, 503, 504]) expect(lineHttpFailure(status)).toBe("unknown");
  });
  it("treats unclassified failures as unknown and keeps explicit preflight failures separate", () => {
    expect(lineSendFailure(new TypeError("connection lost"))).toBe("unknown");
    expect(lineSendFailure(new LineSendError("missing configuration", "not_sent"))).toBe("not_sent");
    expect(lineSendFailure(new LineSendError("rejected", "rejected"))).toBe("rejected");
  });
});
