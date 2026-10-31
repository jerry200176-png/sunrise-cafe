import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSignedAdminSession } from "@/lib/admin-api-auth";
const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => db }));
import { GET } from "./route";

const id = "00000000-0000-0000-0000-000000000001";
const context = { params: Promise.resolve({ id }) };
async function request(role?: "finance" | "staff" | "owner", branch = "other") {
  const cookie = role ? `admin_session=${await createSignedAdminSession("test-session", 3600, { role, sub: "test-user", branch_ids: role === "owner" ? null : ["allowed"] })}` : "";
  return new NextRequest(`http://localhost/api/admin/orders/${id}?branchId=${branch}`, { headers: { cookie } });
}
describe("pending print status lookup", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "test-admin"); vi.stubEnv("SESSION_SECRET", "test-session"); vi.clearAllMocks();
    db.from.mockReturnValue(db); db.select.mockReturnValue(db); db.eq.mockReturnValue(db);
    db.maybeSingle.mockResolvedValue({ data: { id, branch_id: "allowed", is_printed: true, status: "completed" }, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects unauthorized and cross-branch requests before query", async () => {
    expect((await GET(await request(), context)).status).toBe(401);
    expect((await GET(await request("finance"), context)).status).toBe(403);
    expect((await GET(await request("staff"), context)).status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("restricts lookup to the authorized branch and order id", async () => {
    const res = await GET(await request("staff", "allowed"), context);
    expect(await res.json()).toEqual({ id, branch_id: "allowed", is_printed: true, status: "completed" });
    expect(db.eq).toHaveBeenCalledWith("branch_id", "allowed");
    expect(db.eq).toHaveBeenCalledWith("id", id);
  });
  it("fails closed for absent and failed lookups", async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { message: "failure" } });
    expect((await GET(await request("staff", "allowed"), context)).status).toBe(404);
    expect((await GET(await request("staff", "allowed"), context)).status).toBe(503);
  });
});
