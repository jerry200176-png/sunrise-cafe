import { describe, expect, it, vi } from "vitest";
import { probeOpsEvents } from "./ops-events-readiness.mjs";

const config = { url: "https://synthetic.invalid", key: "synthetic-key-".repeat(5) };

describe("ops_events read-only REST readiness", () => {
  it.each([[[]], [[{ id: "synthetic" }]]])("accepts a valid REST response %j", async (body) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }));
    expect(await probeOpsEvents({ ...config, fetchImpl })).toBe(true);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://synthetic.invalid/rest/v1/ops_events?select=id&limit=1");
    expect(options?.method).toBeUndefined();
  });

  it.each([
    [401, '{"code":"PGRST205","message":"does not exist"}'],
    [403, '{"message":"permission denied"}'], [404, '{"code":"PGRST205"}'],
    [500, '{"code":"42P01"}'], [200, 'not-json'], [200, '{}'], [200, '[{}]'],
  ])("fails closed for HTTP %s or invalid data", async (status, body) => {
    const fetchImpl = vi.fn(async () => new Response(body, { status }));
    expect(await probeOpsEvents({ ...config, fetchImpl })).toBe(false);
  });

  it("fails closed without usable config or after a timeout", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("synthetic private detail"); });
    expect(await probeOpsEvents({ url: "", key: "", fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await probeOpsEvents({ ...config, fetchImpl })).toBe(false);
  });
});
