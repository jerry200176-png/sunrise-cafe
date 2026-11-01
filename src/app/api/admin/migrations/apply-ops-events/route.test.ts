import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ permission: vi.fn() }));
vi.mock("@/lib/admin-api-auth", () => ({ requirePermission: mocks.permission }));
import { GET, POST } from "./route";

const request = (token = "synthetic-secret") => new NextRequest("https://synthetic.invalid/api/admin/migrations/apply-ops-events", {
  method: "POST", headers: { authorization: `Bearer ${token}` },
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.stubEnv("OPS_EVENTS_DIAGNOSTIC_ALLOWED_ORIGIN", "https://synthetic.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-".repeat(5));
  vi.stubEnv("CRON_SECRET", "synthetic-secret");
  vi.stubEnv("SUPABASE_DB_URL", "");
  mocks.permission.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("ops_events compatibility endpoint", () => {
  it("requires the existing permission for non-cron callers before a probe", async () => {
    const fetchImpl = vi.fn(); vi.stubGlobal("fetch", fetchImpl);
    mocks.permission.mockResolvedValue(NextResponse.json({ error: "denied" }, { status: 403 }));
    expect((await POST(request("wrong"))).status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("does not claim readiness or probe even when the REST response would be 200", async () => {
    const fetchImpl = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "ops_events migration readiness unverified; no migration was run" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 500])("rejects HTTP %s without applying a migration", async (status) => {
    const fetchImpl = vi.fn(async () => new Response('{"code":"PGRST205"}', { status }));
    vi.stubGlobal("fetch", fetchImpl);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "ops_events migration readiness unverified; no migration was run" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("exposes the projection only as an unverified diagnostic", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    expect(await (await GET()).json()).toMatchObject({ table_ready: false, rest_projection_visible: true });
  });
  it("does not send credentials from GET when the allowed origin is absent", async () => {
    vi.stubEnv("OPS_EVENTS_DIAGNOSTIC_ALLOWED_ORIGIN", "");
    const fetchImpl = vi.fn(); vi.stubGlobal("fetch", fetchImpl);
    expect(await (await GET()).json()).toMatchObject({ table_ready: false, rest_projection_visible: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("does not claim readiness for malformed responses or missing credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid", { status: 200 })));
    expect((await GET()).status).toBe(200);
    expect(await (await GET()).json()).toMatchObject({ table_ready: false, postgres_url_configured: false });
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await POST(request())).status).toBe(503);
  });
});
