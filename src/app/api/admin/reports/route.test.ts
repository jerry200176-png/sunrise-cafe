import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getAdminContext: vi.fn(),
  fetchReportRows: vi.fn(),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requirePermission: mocks.requirePermission,
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: () => true }));
vi.mock("@/lib/overview-data", () => ({ fetchReportRows: mocks.fetchReportRows }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));

import { GET } from "./route";

const get = (qs = "") => GET(new NextRequest(`http://localhost/api/admin/reports${qs}`));

describe("GET /api/admin/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(null);
    mocks.fetchReportRows.mockResolvedValue({ reservations: [], orders: [] });
    mocks.getAdminContext.mockResolvedValue({ user_id: "m", role: "branch_manager", branch_ids: ["b1"], legacy: false });
  });

  it("rejects unauthenticated requests before touching data", async () => {
    mocks.requirePermission.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await get()).status).toBe(401);
    expect(mocks.fetchReportRows).not.toHaveBeenCalled();
  });

  it("foreign branch is 403; allowed branch and 'all' are scoped", async () => {
    expect((await get("?branchId=b2")).status).toBe(403);
    expect(mocks.fetchReportRows).not.toHaveBeenCalled();
    expect((await get("?branchId=b1")).status).toBe(200);
    expect(mocks.fetchReportRows.mock.calls[0][1]).toEqual(["b1"]);
    expect((await get()).status).toBe(200);
    expect(mocks.fetchReportRows.mock.calls[1][1]).toEqual(["b1"]);
  });

  it("shared owner account sees everything and the response has no summed revenue", async () => {
    mocks.getAdminContext.mockResolvedValue({ user_id: null, role: "owner", branch_ids: null, legacy: true });
    const res = await get("?months=3");
    const body = await res.json();
    expect(mocks.fetchReportRows.mock.calls[0][1]).toBeNull();
    expect(body.monthly).toHaveLength(3);
    expect(body.summary).not.toHaveProperty("total_revenue");
  });
});
