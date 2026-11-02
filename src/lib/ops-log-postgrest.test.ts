import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { logOps } from "@/lib/ops-log";

const hooks = vi.hoisted(() => ({
  after: vi.fn(),
  configured: vi.fn(),
}));

vi.mock("next/server", () => ({ after: hooks.after }));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: hooks.configured }));

describe("logOps with the real PostgREST client", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
    hooks.configured.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    hooks.after.mockReset();
    hooks.configured.mockReset();
  });

  it("reports network reset as unknown outcome without logging private error data", async () => {
    const reset = Object.assign(new TypeError("fetch failed with private payload"), {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    });
    const fetchMock = vi.fn(() => Promise.reject(reset));
    vi.stubGlobal("fetch", fetchMock);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    const directClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const directResult = await directClient
      .from("ops_events")
      .insert({ domain: "payment", action: "payment.deposit_confirmed", detail: {} });
    expect(directResult.status).toBe(0);
    expect(directResult.error?.code).toBe("");
    fetchMock.mockClear();

    logOps("payment", "payment.deposit_confirmed", { customer: "private-customer" });
    const work = hooks.after.mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
    if (!work) throw new Error("Expected Next after callback");
    await work();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0][0]).toContain('"reason":"outcome_unknown"');
    expect(warning.mock.calls[0][0]).not.toContain("private payload");
    expect(warning.mock.calls[0][0]).not.toContain("private-customer");
  });
});
