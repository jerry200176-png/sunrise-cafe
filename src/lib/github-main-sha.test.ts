import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMainCommitSha } from "./github-main-sha";

const ORIGINAL_TOKEN = process.env.GITHUB_TOKEN;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = ORIGINAL_TOKEN;
  vi.restoreAllMocks();
});

function response(status: number, body: unknown = {}, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as Response;
}

const MAIN_SHA = "f".repeat(40);

describe("fetchMainCommitSha", () => {
  it("resolves main SHA with a production GitHub bearer token", async () => {
    process.env.GITHUB_TOKEN = "read-only-token";
    const fetchMock = vi.fn().mockResolvedValue(response(200, { sha: MAIN_SHA }));

    await expect(fetchMainCommitSha({ fetchImpl: fetchMock })).resolves.toBe(MAIN_SHA);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer read-only-token");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("does not retry a private-repository 404 when unauthenticated", async () => {
    delete process.env.GITHUB_TOKEN;
    const fetchMock = vi.fn().mockResolvedValue(response(404));
    const sleepMock = vi.fn().mockResolvedValue(undefined);

    await expect(fetchMainCommitSha({ fetchImpl: fetchMock, sleep: sleepMock })).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("retries a transient GitHub failure before resolving", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200, { sha: MAIN_SHA }));
    const sleepMock = vi.fn().mockResolvedValue(undefined);

    await expect(fetchMainCommitSha({ fetchImpl: fetchMock, sleep: sleepMock })).resolves.toBe(MAIN_SHA);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(250);
  });

  it("retries network failures and remains fail-safe after exhaustion", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network timeout"));
    const sleepMock = vi.fn().mockResolvedValue(undefined);

    await expect(fetchMainCommitSha({ fetchImpl: fetchMock, sleep: sleepMock })).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 250);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 1_000);
  });
});
