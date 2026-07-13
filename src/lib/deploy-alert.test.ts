import { describe, expect, it } from "vitest";
import { formatDeployMismatchAlert } from "./deploy-alert";

describe("deploy-alert", () => {
  it("formats SHA mismatch for LINE", () => {
    const text = formatDeployMismatchAlert({
      mainSha: "abcdef1234567890",
      prodSha: "1111111111111111",
      mainShort: "abcdef1",
      prodShort: "1111111",
    });
    expect(text).toContain("Production 部署異常");
    expect(text).toContain("abcdef1");
    expect(text).toContain("1111111");
    expect(text).toContain("vercel deploy --prod");
  });
});
