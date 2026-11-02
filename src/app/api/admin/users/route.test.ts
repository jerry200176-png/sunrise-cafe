import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  userRows: [] as unknown[],
  userCount: 0 as number | null,
  linkRows: [] as unknown[],
  linkCount: 0 as number | null,
  linkError: null as null | { message: string },
}));

vi.mock("@/lib/admin-api-auth", () => ({ requirePermission: mocks.requirePermission, getAdminContext: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: () => true }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => table === "admin_users"
      ? { select: () => ({
          limit: async () => ({ error: null }),
          order: async () => ({ data: mocks.userRows, count: mocks.userCount, error: null }),
        }) }
      : { select: async () => ({ data: mocks.linkRows, count: mocks.linkCount, error: mocks.linkError }) },
  }),
}));

const request = () => new NextRequest("http://localhost/api/admin/users");
beforeEach(() => {
  mocks.requirePermission.mockResolvedValue(null);
  mocks.userRows = [{ id: "u1", email: "test@example.test", display_name: "Test", role: "staff", is_active: true, created_at: "2026-01-01" }];
  mocks.userCount = 1;
  mocks.linkRows = [{ user_id: "u1", branch_id: "b1" }];
  mocks.linkCount = 1;
  mocks.linkError = null;
});

describe("GET admin users", () => {
  it("returns a complete account and branch list", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ users: [{ id: "u1", branch_ids: ["b1"] }] });
  });

  it("returns an error when branch lookup fails rather than a false empty association", async () => {
    mocks.linkRows = [];
    mocks.linkCount = null;
    mocks.linkError = { message: "sensitive upstream error" };
    const response = await GET(request());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("無法確認完整使用者分店關聯");
    expect(JSON.stringify(body)).not.toContain("sensitive upstream error");
  });

  it.each(["users", "branches"])("fails closed on a truncated %s list", async (which) => {
    if (which === "users") mocks.userCount = 2;
    else mocks.linkCount = 2;
    const response = await GET(request());
    expect(response.status).toBe(500);
  });

  it("preserves the existing permission gate", async () => {
    mocks.requirePermission.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.any(NextRequest), "users:manage");
  });
});
