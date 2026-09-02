import { describe, expect, it } from "vitest";
import { isRuntimeChanged } from "../../scripts/record-deploy-health-head.mjs";

describe("isRuntimeChanged", () => {
  it("keeps non-runtime BI/docs changes benign", () => {
    expect(isRuntimeChanged(["docs/runbook.md", "orchestrator/business-snapshot.json"])).toBe(false);
    expect(isRuntimeChanged([".github/workflows/verify-production.yml", "README.md"])).toBe(false);
    expect(isRuntimeChanged(["src/app/api/version/route.ts"])).toBe(true);
  });
});
