import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: vi.fn(() => true),
  fetchBranch: vi.fn(),
  getBlockedSlots: vi.fn(),
}));
vi.mock("@/lib/admin-api-auth", () => ({ hasValidAdminSession: vi.fn(async () => false) }));
vi.mock("@/lib/rate-limit", () => ({ getRateLimitMode: vi.fn(() => "memory") }));
vi.mock("@/lib/stripe", () => ({ isStripeEnabled: vi.fn(() => false) }));

import { GET } from "./route";
import { fetchBranch, getBlockedSlots, isAdminConfigured } from "@/lib/supabase-admin";
import { hasValidAdminSession } from "@/lib/admin-api-auth";

const request = () => new NextRequest("http://localhost/api/booking-health");
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("public booking health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key");
    vi.mocked(isAdminConfigured).mockReturnValue(true);
    vi.mocked(fetchBranch).mockResolvedValue({ id: "active", archived_at: null } as never);
    vi.mocked(getBlockedSlots).mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => response([{ id: "active" }])));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("checks an active branch and the availability RPC before reporting healthy", async () => {
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ ok: true });
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("archived_at=is.null");
    expect(fetchBranch).toHaveBeenCalledWith("active");
    expect(getBlockedSlots).toHaveBeenCalledWith("active", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("fails without an active branch and does not call the RPC", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response([]));
    const result = await GET(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false });
    expect(getBlockedSlots).not.toHaveBeenCalled();
  });

  it.each([null, { id: "active", archived_at: "2026-01-01" }, { id: "wrong", archived_at: null }])(
    "fails when selected branch is missing, archived, or mismatched",
    async (branch) => {
      vi.mocked(fetchBranch).mockResolvedValueOnce(branch as never);
      const result = await GET(request());
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({ ok: false });
      expect(getBlockedSlots).not.toHaveBeenCalled();
    }
  );

  it("does not report success for an invalid or failing availability RPC", async () => {
    vi.mocked(getBlockedSlots).mockResolvedValueOnce(null as never);
    expect((await GET(request())).status).toBe(503);
    vi.mocked(getBlockedSlots).mockRejectedValueOnce(new Error("synthetic-private"));
    const result = await GET(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false });
  });

  it("preserves admin diagnostics while reporting unavailable active branches", async () => {
    vi.mocked(hasValidAdminSession).mockResolvedValueOnce(true);
    vi.mocked(fetch).mockResolvedValueOnce(response([]));
    const result = await GET(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ ok: false, serviceRoleConfigured: true, error: "no active branch available" });
  });
});
