import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchExpectedMainHead, parseExpectedMainHead } from "./expected-main-head";

const MAIN_SHA = "A".repeat(40);
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  vi.restoreAllMocks();
});

function response(status: number, body: unknown = []) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("parseExpectedMainHead", () => {
  it("accepts only workflow-sourced full SHAs", () => {
    expect(
      parseExpectedMainHead([
        {
          ts: "2026-09-02T07:30:00.000Z",
          detail: { sha: MAIN_SHA, source: "github-actions", runtime_changed: false },
        },
      ])
    ).toEqual({
      sha: MAIN_SHA.toLowerCase(),
      runtimeChanged: false,
      recordedAt: "2026-09-02T07:30:00.000Z",
    });
  });

  it("rejects malformed or non-workflow metadata", () => {
    expect(parseExpectedMainHead([{ detail: { sha: "short", source: "github-api" } }])).toBeNull();
  });
});

describe("fetchExpectedMainHead", () => {
  it("reads ops_events with the service-role key and never needs GitHub auth", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co/";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const fetchMock = vi.fn().mockResolvedValue(
      response(200, [{ ts: "2026-09-02T07:30:00.000Z", detail: { sha: MAIN_SHA, source: "github-actions", runtime_changed: true } }])
    );

    await expect(fetchExpectedMainHead({ fetchImpl: fetchMock })).resolves.toMatchObject({
      sha: MAIN_SHA.toLowerCase(),
      runtimeChanged: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/rest/v1/ops_events?");
    expect(url).toContain("action=eq.main_head");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer service-role-key");
  });

  it("retries transient Supabase failures and remains fail-safe", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const fetchMock = vi.fn().mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200, []));
    const sleepMock = vi.fn().mockResolvedValue(undefined);

    await expect(fetchExpectedMainHead({ fetchImpl: fetchMock, sleep: sleepMock })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(250);
  });
});
