import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSignedAdminSession } from "@/lib/admin-api-auth";

const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => db }));
import { GET } from "./route";

async function request(role?: "finance" | "staff" | "owner", branch = "other") {
  const cookie = role ? `admin_session=${await createSignedAdminSession("test-session", 3600, { role, sub: "test-user", branch_ids: role === "owner" ? null : ["allowed"] })}` : "";
  return new NextRequest(`http://localhost/api/admin/orders?branchId=${branch}&limit=2&listContract=v2`, { headers: { cookie } });
}

describe("orders v2 list authorization", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "test-admin");
    vi.stubEnv("SESSION_SECRET", "test-session");
    vi.clearAllMocks();
    db.from.mockReturnValue(db); db.select.mockReturnValue(db); db.eq.mockReturnValue(db); db.order.mockReturnValue(db);
    db.limit.mockResolvedValue({ data: [], count: 0, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects unauthenticated, finance and cross-branch staff requests before querying", async () => {
    expect((await GET(await request(undefined, "allowed"))).status).toBe(401);
    expect((await GET(await request("finance", "allowed"))).status).toBe(403);
    expect((await GET(await request("staff", "other"))).status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("permits assigned staff and unrestricted owner", async () => {
    expect((await GET(await request("staff", "allowed"))).status).toBe(200);
    expect((await GET(await request("owner", "other"))).status).toBe(200);
    expect(db.eq).toHaveBeenCalledWith("branch_id", "allowed");
    expect(db.eq).toHaveBeenCalledWith("branch_id", "other");
  });

  it("rejects a forged synthetic v2 session before querying", async () => {
    const signed = await createSignedAdminSession("test-session", 3600, { role: "staff", sub: "test-user", branch_ids: ["allowed"] });
    const forged = `${signed.slice(0, -1)}${signed.endsWith("a") ? "b" : "a"}`;
    const req = new NextRequest("http://localhost/api/admin/orders?branchId=allowed&limit=2&listContract=v2", { headers: { cookie: `admin_session=${forged}` } });
    expect((await GET(req)).status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });
});
