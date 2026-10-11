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
const upserts: unknown[] = [];
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => Object.assign(Promise.resolve({ data: [], error: null }), { in: () => Promise.resolve({ data: [], error: null }) }),
      upsert: (row: unknown) => { upserts.push(row); return Promise.resolve({ error: null }); },
    }),
  }),
}));

import { GET, POST } from "./route";

const get = (qs = "") => GET(new NextRequest(`http://localhost/api/admin/advice${qs}`));

describe("GET /api/admin/advice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(null);
    mocks.loadAdvice.mockResolvedValue({ enough: true, top: [{ id: "no-show:b1", title: "t", numbers: [], impactNt: 5 }], more: [] });
    upserts.length = 0;
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

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/advice", { method: "POST", body: JSON.stringify(body) }));
describe("POST /api/admin/advice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upserts.length = 0;
    mocks.requirePermission.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({ user_id: "m1", role: "branch_manager", branch_ids: ["b1"], legacy: false });
    mocks.loadAdvice.mockResolvedValue({ enough: true, top: [{ id: "no-show:b1", title: "t", numbers: [{ label: "a", value: "1" }], impactNt: 5 }], more: [] });
  });
  it("records an adopt for a current suggestion in an allowed branch", async () => {
    expect((await post({ suggestionId: "no-show:b1", decision: "adopted" })).status).toBe(200);
    expect(upserts[0]).toMatchObject({ suggestion_id: "no-show:b1", branch_id: "b1", decision: "adopted", snapshot: { title: "t" } });
  });
  it("foreign branch: 403, nothing written", async () => {
    expect((await post({ suggestionId: "no-show:b2", decision: "skipped" })).status).toBe(403);
    expect(upserts).toEqual([]);
  });
  it("unknown suggestion: 404; bad body: 400", async () => {
    expect((await post({ suggestionId: "repeat:b1", decision: "skipped" })).status).toBe(404);
    expect((await post({ suggestionId: "no-show:b1", decision: "maybe" })).status).toBe(400);
    expect(upserts).toEqual([]);
  });
  it("needs campaigns:write", async () => {
    mocks.requirePermission.mockResolvedValueOnce(NextResponse.json({ error: "x" }, { status: 403 }));
    expect((await post({ suggestionId: "no-show:b1", decision: "skipped" })).status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "campaigns:write");
  });
});
