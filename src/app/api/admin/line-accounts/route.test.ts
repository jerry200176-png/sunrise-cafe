import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ requirePermission: vi.fn(), auditLineAccounts: vi.fn() }));
vi.mock("@/lib/admin-api-auth", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/line-account-audit", () => ({ auditLineAccounts: mocks.auditLineAccounts }));

import { GET } from "./route";

const get = () => GET(new NextRequest("http://localhost/api/admin/line-accounts"));

describe("GET /api/admin/line-accounts", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("is owner-only (line:audit) and does not call LINE when denied", async () => {
    mocks.requirePermission.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    const res = await get();
    expect(res.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.anything(), "line:audit");
    expect(mocks.auditLineAccounts).not.toHaveBeenCalled();
  });

  it("returns the audit with no-store caching", async () => {
    mocks.requirePermission.mockResolvedValue(null);
    mocks.auditLineAccounts.mockResolvedValue({ fetchedAt: "t", accounts: [], collisions: [] });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ fetchedAt: "t", accounts: [], collisions: [] });
  });
});
