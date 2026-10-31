import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSignedAdminSession } from "@/lib/admin-api-auth";

const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: db.from }) }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,test") } }));
import { GET } from "./route";

async function request(role?: "finance" | "staff" | "owner") {
  const cookie = role ? `admin_session=${await createSignedAdminSession("test-session", 3600, { role, sub: "test-user", branch_ids: role === "owner" ? null : ["allowed"] })}` : "";
  return new NextRequest("http://localhost/api/admin/tables/table-a/qr", { headers: { cookie } });
}
const params = { params: Promise.resolve({ id: "table-a" }) };

describe("桌位 QR 的角色與分店範圍", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "test-admin");
    vi.stubEnv("SESSION_SECRET", "test-session");
    vi.clearAllMocks();
    db.from.mockReturnValue(db);
    db.select.mockReturnValue(db);
    db.eq.mockReturnValue(db);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("未登入 401、finance 403，資料庫不應被查詢", async () => {
    expect((await GET(await request(), params)).status).toBe(401);
    expect((await GET(await request("finance"), params)).status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("員工跨店回 404，且不讀取或回傳 QR token", async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: { branch_id: "other" }, error: null });
    const res = await GET(await request("staff"), params);
    expect(res.status).toBe(404);
    expect(await res.clone().json()).toEqual({ error: "找不到此桌位" });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledWith("branch_id");
    expect(JSON.stringify(await res.json())).not.toContain("qr_token");
  });

  it("員工可取得獲准分店的桌位 QR，並在第二次查詢限制分店", async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: { branch_id: "allowed" }, error: null });
    db.maybeSingle.mockResolvedValueOnce({ data: { qr_token: "synthetic", number: "A1" }, error: null });
    const res = await GET(await request("staff"), params);
    expect(res.status).toBe(200);
    expect((await res.json()).order_url).toBe("http://localhost/order/synthetic");
    expect(db.eq).toHaveBeenCalledWith("branch_id", "allowed");
  });

  it("不存在的桌位回 404，資料庫失敗不回傳內部錯誤", async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await GET(await request("staff"), params)).status).toBe(404);
    db.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "internal secret" } });
    const response = await GET(await request("staff"), params);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("internal secret");
  });

  it("桌位缺少分店時拒絕，且不讀取 QR", async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: { branch_id: null }, error: null });
    expect((await GET(await request("staff"), params)).status).toBe(404);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledWith("branch_id");
  });
});
