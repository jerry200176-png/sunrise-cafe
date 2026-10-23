import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  fetchDashboardBundle: vi.fn(),
  isAdminConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/admin-dashboard-data", async (importOriginal) => ({
  isDashboardDate: (await importOriginal<typeof import("@/lib/admin-dashboard-data")>()).isDashboardDate,
  fetchDashboardBundle: mocks.fetchDashboardBundle,
}));
vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: mocks.isAdminConfigured,
}));

import { GET } from "./route";

function request(url = "http://localhost/api/admin/dashboard?branchId=b1&date=2026-09-02") {
  return new NextRequest(url);
}

describe("GET /api/admin/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(null);
    mocks.fetchDashboardBundle.mockResolvedValue({ date: "2026-09-02" });
  });

  it("requires reservations read permission for the requested branch", async () => {
    mocks.requirePermission.mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "reservations:read",
      "b1"
    );
    expect(mocks.fetchDashboardBundle).not.toHaveBeenCalled();
  });

  it("passes the selected branch and Taipei date to the data bundle", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.fetchDashboardBundle).toHaveBeenCalledWith("b1", "2026-09-02");
  });

  it("rejects a malformed date with 400 before querying", async () => {
    const response = await GET(request("http://localhost/api/admin/dashboard?branchId=b1&date=2026-9-2"));
    expect(response.status).toBe(400);
    expect(mocks.fetchDashboardBundle).not.toHaveBeenCalled();
  });
});
