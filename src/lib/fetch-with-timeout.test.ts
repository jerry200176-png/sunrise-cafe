import { describe, expect, it } from "vitest";
import { fetchWithTimeout, readJsonWithTimeout } from "./fetch-with-timeout";

describe("readJsonWithTimeout", () => {
  it("parses a response body as JSON", async () => {
    const response = new Response(JSON.stringify({ ok: true, count: 3 }));
    await expect(readJsonWithTimeout<{ ok: boolean; count: number }>(response)).resolves.toEqual({
      ok: true,
      count: 3,
    });
  });

  it("fails with a readable message and cancels a body that never completes", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"partial":'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body);

    await expect(readJsonWithTimeout(response, 20)).rejects.toThrow("讀取資料逾時，請重試");
    expect(cancelled).toBe(true);
  });

  it("also bounds JSON parsing when no readable body is exposed", async () => {
    const response = { body: null, json: () => new Promise(() => {}) } as unknown as Response;
    await expect(readJsonWithTimeout(response, 20)).rejects.toThrow("讀取資料逾時，請重試");
  });

  it("keeps fetchWithTimeout returning the original Response", async () => {
    const response = new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response;
    try {
      await expect(fetchWithTimeout("/test", undefined, 100)).resolves.toBe(response);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
