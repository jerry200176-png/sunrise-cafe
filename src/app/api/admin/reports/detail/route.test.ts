import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getAdminContext: vi.fn(),
  fetchDetailRows: vi.fn(),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requirePermission: mocks.requirePermission,
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: () => true }));
vi.mock("@/lib/report-detail", async (orig) => ({ ...(await orig<typeof import("@/lib/report-detail")>()), fetchDetailRows: mocks.fetchDetailRows }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));

import { GET } from "./route";

const get = (qs = "") => GET(new NextRequest(`http://localhost/api/admin/reports/detail${qs}`));

describe("GET /api/admin/reports/detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(null);
    mocks.fetchDetailRows.mockResolvedValue([]);
    mocks.getAdminContext.mockResolvedValue({ user_id: "m", role: "branch_manager", branch_ids: ["b1"], legacy: false });
  });

  it("rejects unauthenticated requests before touching data", async () => {
    mocks.requirePermission.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await get("?month=2026-10")).status).toBe(401);
    expect(mocks.requirePermission.mock.calls[0][1]).toBe("bi:read");
    expect(mocks.fetchDetailRows).not.toHaveBeenCalled();
  });

  it("foreign branch is 403 and a bad month is 400, both without reading data", async () => {
    expect((await get("?month=2026-10&branchId=b2")).status).toBe(403);
    expect((await get("?month=2026-13")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    expect(mocks.fetchDetailRows).not.toHaveBeenCalled();
  });

  it("returns a CSV download for the Taipei month, scoped to the allowed branches", async () => {
    const res = await get("?month=2026-10");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const [, scope, from, to] = mocks.fetchDetailRows.mock.calls[0];
    expect(scope).toEqual(["b1"]);
    expect(from).toBe("2026-09-30T16:00:00.000Z");
    expect(to).toBe("2026-10-31T16:00:00.000Z");
    // Excel 需要 UTF-8 BOM 才不會把中文變亂碼（Response.text() 會吃掉 BOM，所以看原始位元組）
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes).startsWith("日期,")).toBe(true);
  });
});
