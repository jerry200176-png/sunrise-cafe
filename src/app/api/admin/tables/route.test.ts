import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSignedAdminSession } from "@/lib/admin-api-auth";

const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), insert: vi.fn(), single: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: db.from }) }));
import { GET, POST } from "./route";

async function request(method: "GET" | "POST", role?: "finance" | "staff" | "owner", branch = "other") {
  const cookie = role ? `admin_session=${await createSignedAdminSession("test-session", 3600, { role, sub: "test-user", branch_ids: role === "owner" ? null : ["allowed"] })}` : "";
  const headers = { cookie, "content-type": "application/json" };
  return new NextRequest(`http://localhost/api/admin/tables?branchId=${branch}`, {
    method, headers, ...(method === "POST" ? { body: JSON.stringify({ branch_id: branch, number: "A1" }) } : {}),
  });
}

describe("桌位 API 的角色與分店範圍", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "test-admin");
    vi.stubEnv("SESSION_SECRET", "test-session");
    vi.clearAllMocks();
    db.from.mockReturnValue(db);
    db.select.mockReturnValue(db);
    db.eq.mockReturnValue(db);
    db.insert.mockReturnValue(db);
    db.order.mockResolvedValue({ data: [{ id: "table-a", branch_id: "allowed", number: "A1" }], count: 1, error: null });
    db.single.mockResolvedValue({ data: { id: "table-a", branch_id: "allowed", number: "A1" }, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["GET", "POST"] as const)("%s 拒絕未登入、無權限與跨分店請求，且不查詢或寫入", async (method) => {
    const call = method === "GET" ? GET : POST;
    expect((await call(await request(method))).status).toBe(401);
    expect((await call(await request(method, "finance"))).status).toBe(403);
    expect((await call(await request(method, "staff"))).status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("允許員工讀取獲准分店的桌位", async () => {
    const response = await GET(await request("GET", "staff", "allowed"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "table-a", branch_id: "allowed", number: "A1" }]);
    expect(db.eq).toHaveBeenCalledWith("branch_id", "allowed");
    expect(db.select).toHaveBeenCalledWith("*", { count: "exact" });
  });

  it.each([
    { data: [{ id: "table-a" }], count: 2, error: null },
    { data: [], count: null, error: null },
    { data: null, count: 0, error: null },
    { data: null, count: null, error: { message: "private db detail" } },
  ])("清單不完整或查詢失敗時拒絕當作可核對清單", async (result) => {
    db.order.mockResolvedValue(result);
    const response = await GET(await request("GET", "staff", "allowed"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private db detail");
  });

  it("允許員工新增獲准分店的桌位", async () => {
    const response = await POST(await request("POST", "staff", "allowed"));
    expect(response.status).toBe(200);
    expect(db.insert).toHaveBeenCalledWith({ branch_id: "allowed", number: "A1" });
  });

  it("允許老闆管理其他分店", async () => {
    expect((await GET(await request("GET", "owner", "other"))).status).toBe(200);
    expect((await POST(await request("POST", "owner", "other"))).status).toBe(200);
    expect(db.eq).toHaveBeenCalledWith("branch_id", "other");
    expect(db.insert).toHaveBeenCalledWith({ branch_id: "other", number: "A1" });
  });
});
