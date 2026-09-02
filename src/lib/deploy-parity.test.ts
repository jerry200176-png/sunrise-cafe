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
  const originalToken = process.env.GITHUB_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
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

  it("authenticates GitHub compare requests for the private repository", async () => {
    process.env.GITHUB_TOKEN = "read-only-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await assessDeployParity("prodsha", "mainsha");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer read-only-token");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("retries transient compare failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [] }) });
    const sleepMock = vi.fn().mockResolvedValue(undefined);

    const result = await assessDeployParity("prodsha", "mainsha", {
      fetchImpl: fetchMock,
      sleep: sleepMock,
    });

    expect(result.compareOk).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(250);
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
