import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getAdminContext: vi.fn(),
  fetchTomorrowsReservations: vi.fn(),
  isAdminConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requirePermission: mocks.requirePermission,
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/supabase-admin", () => ({
  fetchTomorrowsReservations: mocks.fetchTomorrowsReservations,
  isAdminConfigured: mocks.isAdminConfigured,
}));

import { GET } from "./route";

describe("GET /api/admin/reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({
      user_id: "staff-1",
      role: "staff",
      branch_ids: ["b1"],
      legacy: false,
    });
    mocks.fetchTomorrowsReservations.mockResolvedValue([
      { id: "r1", room: { branch_id: "b1", name: "A" } },
      { id: "r2", room: { branch_id: "b2", name: "B" } },
    ]);
  });

  it("requires reservation read permission", async () => {
    mocks.requirePermission.mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await GET(new NextRequest("http://localhost/api/admin/reminders"));

    expect(response.status).toBe(401);
    expect(mocks.fetchTomorrowsReservations).not.toHaveBeenCalled();
  });

  it("filters tomorrow reminders to the staff member's assigned branches", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/reminders"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.map((row: { id: string }) => row.id)).toEqual(["r1"]);
  });
});
