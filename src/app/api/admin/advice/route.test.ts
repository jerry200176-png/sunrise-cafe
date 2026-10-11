import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getAdminContext: vi.fn(),
  loadAdvice: vi.fn(),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requirePermission: mocks.requirePermission,
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: () => true }));
vi.mock("@/lib/advice-data", () => ({ loadAdvice: mocks.loadAdvice }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));

import { GET } from "./route";

const get = (qs = "") => GET(new NextRequest(`http://localhost/api/admin/advice${qs}`));

describe("GET /api/admin/advice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(null);
    mocks.loadAdvice.mockResolvedValue({ ok: true });
    mocks.getAdminContext.mockResolvedValue({ user_id: "m1", role: "branch_manager", branch_ids: ["b1"], legacy: false });
  });

  it("rejects without bi:read / session", async () => {
    mocks.requirePermission.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await get()).status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "bi:read");
    expect(mocks.loadAdvice).not.toHaveBeenCalled();
  });

  it("allowed branch is served, scoped to that branch only", async () => {
    expect((await get("?branchId=b1")).status).toBe(200);
    expect(mocks.loadAdvice).toHaveBeenCalledWith(expect.anything(), ["b1"]);
  });

  it("foreign branch is 403 and never queried", async () => {
    expect((await get("?branchId=b2")).status).toBe(403);
    expect(mocks.loadAdvice).not.toHaveBeenCalled();
  });

  it("no branch = only the account's allowed branches", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: "m1", role: "branch_manager", branch_ids: ["b1", "b3"], legacy: false });
    expect((await get()).status).toBe(200);
    expect(mocks.loadAdvice).toHaveBeenCalledWith(expect.anything(), ["b1", "b3"]);
  });

  it("owner / shared account (branch_ids null) with no branch = unrestricted", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: null, role: "owner", branch_ids: null, legacy: true });
    expect((await get()).status).toBe(200);
    expect(mocks.loadAdvice).toHaveBeenCalledWith(expect.anything(), null);
  });
});
