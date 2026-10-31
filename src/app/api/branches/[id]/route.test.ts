import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  updateBranch: vi.fn(async () => {}),
  setBranchArchived: vi.fn(async () => {}),
}));
vi.mock("@/lib/supabase-fetch", () => ({
  updateBranch: mocks.updateBranch,
  setBranchArchived: mocks.setBranchArchived,
}));
vi.mock("@/lib/admin-api-auth", () => ({ requirePermission: async () => null }));

import { DELETE, PATCH } from "./route";

const ctx = { params: Promise.resolve({ id: "b1" }) };

describe("branch archive instead of delete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("DELETE archives the branch and never removes rows", async () => {
    const res = await DELETE(new NextRequest("http://x/api/branches/b1", { method: "DELETE" }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.setBranchArchived).toHaveBeenCalledWith("b1", true);
  });

  it("PATCH {archived:false} restores without touching other fields", async () => {
    const res = await PATCH(
      new NextRequest("http://x/api/branches/b1", { method: "PATCH", body: JSON.stringify({ archived: false }) }),
      ctx
    );
    expect(res.status).toBe(200);
    expect(mocks.setBranchArchived).toHaveBeenCalledWith("b1", false);
    expect(mocks.updateBranch).not.toHaveBeenCalled();
  });
});
