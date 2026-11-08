import { afterEach, describe, expect, it, vi } from "vitest";
import { recordDeployMismatch } from "./deploy-alert";

describe("deployment mismatch recording", () => {
  afterEach(() => vi.restoreAllMocks());

  it("records short versions without exposing full commits", () => {
    const record = vi.spyOn(console, "error").mockImplementation(() => {});
    recordDeployMismatch({ mainSha: "abcdef1234567890", prodSha: "1111111222222222" });
    expect(record).toHaveBeenCalledWith("[deploy-health] production version mismatch", {
      main: "abcdef1", prod: "1111111",
    });
  });
});
