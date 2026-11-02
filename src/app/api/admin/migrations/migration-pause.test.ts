import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/admin-api-auth", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import * as ops from "./apply-ops-events/route";
import * as reminded from "./apply-reminded-7d/route";
import * as market from "./apply-market-parity/route";

const routes = [["ops events", ops], ["7-day reminder", reminded], ["market parity", market]] as const;
const request = (authorization?: string) => new NextRequest("https://example.test/api/admin/migrations", {
  method: "POST",
  headers: authorization ? { authorization } : {},
});

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "synthetic-cron-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  mocks.requirePermission.mockReset();
  mocks.createClient.mockReset();
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each(routes)("%s migration endpoint", (_name, route) => {
  it("preserves authorization and rejects an unauthorized caller without probing", async () => {
    mocks.requirePermission.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));
    for (const authorization of [undefined, "Bearer wrong-secret"]) {
      const response = await route.POST(request(authorization));
      expect(response.status).toBe(403);
    }
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.any(NextRequest), "bi:read");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not authorize an empty cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    mocks.requirePermission.mockResolvedValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));
    expect((await route.POST(request("Bearer "))).status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(["admin", "cron"])("returns a safe 503 to an authorized %s without a DB or REST probe", async (actor) => {
    mocks.requirePermission.mockResolvedValue(null);
    const response = await route.POST(request(actor === "cron" ? "Bearer synthetic-cron-secret" : undefined));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "資料庫遷移暫停中，請使用經審查的備份與修復流程。" });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    if (actor === "cron") expect(mocks.requirePermission).not.toHaveBeenCalled();
    else expect(mocks.requirePermission).toHaveBeenCalledOnce();
  });
});

describe("read-only migration checks", () => {
  it("keeps the existing GET status response for the ops and reminder probes", async () => {
    mocks.createClient.mockReturnValue({ from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }) });
    expect(await (await ops.GET()).json()).toMatchObject({ table_ready: true });
    expect(await (await reminded.GET()).json()).toMatchObject({ column_ready: true });
  });

  it("keeps the market parity GET status response", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => new Response("[]", { status: 200 }));
    expect(await (await market.GET()).json()).toMatchObject({ ready: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it("does not expose raw upstream errors from read-only checks", async () => {
    const sensitiveDiagnostic = "synthetic-private-upstream-detail";
    mocks.createClient.mockReturnValue({
      from: () => ({ select: () => ({ limit: async () => ({ error: { message: sensitiveDiagnostic } }) }) }),
    });
    vi.mocked(globalThis.fetch).mockImplementation(async () => new Response(sensitiveDiagnostic, { status: 500 }));
    for (const route of [ops, reminded, market]) {
      const text = await (await route.GET()).text();
      expect(text).not.toContain(sensitiveDiagnostic);
      expect(text).toContain("無法確認");
    }
  });

  it("returns an unconfirmed status on a read-only connection failure", async () => {
    mocks.createClient.mockImplementation(() => { throw new Error("synthetic-private-connection"); });
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("synthetic-private-connection"));
    for (const route of [ops, reminded, market]) {
      const text = await (await route.GET()).text();
      expect(text).not.toContain("synthetic-private-connection");
      expect(text).toContain("無法確認");
    }
  });
});
