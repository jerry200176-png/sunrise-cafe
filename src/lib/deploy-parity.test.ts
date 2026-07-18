import { afterEach, describe, expect, it, vi } from "vitest";
import { assessDeployParity, isBenignDeployPath } from "./deploy-parity";

describe("isBenignDeployPath", () => {
  it("allows BI snapshot and docs", () => {
    expect(isBenignDeployPath("orchestrator/business-snapshot.json")).toBe(true);
    expect(isBenignDeployPath("docs/internal/executive/OUTCOME_LOG.md")).toBe(true);
    expect(isBenignDeployPath("README.md")).toBe(true);
  });

  it("rejects runtime / app paths", () => {
    expect(isBenignDeployPath("src/app/api/version/route.ts")).toBe(false);
    expect(isBenignDeployPath("package.json")).toBe(false);
    expect(isBenignDeployPath("vercel.json")).toBe(false);
  });
});

describe("assessDeployParity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns exactMatch when SHAs are equal", async () => {
    const result = await assessDeployParity("abc", "abc");
    expect(result).toEqual({
      exactMatch: true,
      benignDrift: false,
      changedFiles: [],
      compareOk: true,
    });
  });

  it("treats BI-only file drift as benign", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          files: [{ filename: "orchestrator/business-snapshot.json" }],
        }),
      })
    );

    const result = await assessDeployParity("prodsha", "mainsha");
    expect(result.exactMatch).toBe(false);
    expect(result.benignDrift).toBe(true);
    expect(result.compareOk).toBe(true);
    expect(result.changedFiles).toEqual(["orchestrator/business-snapshot.json"]);
  });

  it("treats runtime file drift as actionable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          files: [
            { filename: "orchestrator/business-snapshot.json" },
            { filename: "src/lib/deploy-alert.ts" },
          ],
        }),
      })
    );

    const result = await assessDeployParity("prodsha", "mainsha");
    expect(result.benignDrift).toBe(false);
    expect(result.compareOk).toBe(true);
  });

  it("fails open to actionable when compare API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
    );

    const result = await assessDeployParity("prodsha", "mainsha");
    expect(result.compareOk).toBe(false);
    expect(result.benignDrift).toBe(false);
  });
});
