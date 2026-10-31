import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSignedAdminSession } from "@/lib/admin-api-auth";
import * as fetchLib from "@/lib/supabase-fetch";
import { GET } from "./route";

const PUBLIC_ROW = { id: "b1", name: "大安店", display_name: "昇咖啡大安店" };
const FULL_ROW = { ...PUBLIC_ROW, weekly_hours: { mon: { open: "10:00" } }, line_group_id: "secret-group", payment_info: "account-for-guest", line_pay_url: "https://pay.example", internal_note: "internal" };
const OTHER_ROW = { ...FULL_ROW, id: "b2", name: "其他分店" };

vi.mock("@/lib/supabase-fetch", () => ({
  fetchPublicBranches: vi.fn(async () => [PUBLIC_ROW, { id: "b2", name: "其他分店" }]),
  fetchBranches: vi.fn(async () => [FULL_ROW, OTHER_ROW]),
  insertBranch: vi.fn(async () => {}),
}));

async function request(role?: "owner" | "staff" | "branch_manager" | "finance", branchIds: string[] | null = ["b1"], archived = false) {
  const cookie = role ? `admin_session=${await createSignedAdminSession("test-session", 3600, { role, sub: "test-user", branch_ids: role === "owner" ? null : branchIds })}` : "";
  return new NextRequest(`https://test.local/api/branches${archived ? "?include=archived" : ""}`, { headers: { cookie } });
}

describe("GET /api/branches", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "test-admin");
    vi.stubEnv("SESSION_SECRET", "test-session");
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("guest 行為不變，包括忽略 include=archived", async () => {
    const res = await GET(await request(undefined, null, true));
    expect(await res.json()).toEqual([PUBLIC_ROW, { id: "b2", name: "其他分店" }]);
    expect(fetchLib.fetchPublicBranches).toHaveBeenCalledOnce();
    expect(fetchLib.fetchBranches).not.toHaveBeenCalled();
  });

  it("owner 可讀完整欄位與已封存分店", async () => {
    const res = await GET(await request("owner", null, true));
    expect(await res.json()).toEqual([FULL_ROW, OTHER_ROW]);
    expect(fetchLib.fetchBranches).toHaveBeenCalledWith(true);
  });

  it.each(["staff", "branch_manager"] as const)("%s 只取得授權分店及通知所需付款資訊", async (role) => {
    const res = await GET(await request(role, ["b1"], true));
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...PUBLIC_ROW, weekly_hours: FULL_ROW.weekly_hours, payment_info: FULL_ROW.payment_info, line_pay_url: FULL_ROW.line_pay_url });
    expect(rows[0]).not.toHaveProperty("line_group_id");
    expect(rows[0]).not.toHaveProperty("internal_note");
    expect(fetchLib.fetchBranches).toHaveBeenCalledWith(false);
  });

  it("finance 只取得授權分店公開欄位，不含 LINE 與付款資訊", async () => {
    const res = await GET(await request("finance"));
    const rows = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...PUBLIC_ROW, weekly_hours: FULL_ROW.weekly_hours });
    for (const key of ["payment_info", "line_pay_url", "line_group_id", "internal_note"]) expect(rows[0]).not.toHaveProperty(key);
  });

  it("非 owner 沒有分店指派或 scope 為 null 時 fail closed", async () => {
    expect(await (await GET(await request("staff", []))).json()).toEqual([]);
    expect(await (await GET(await request("staff", null))).json()).toEqual([]);
    expect(fetchLib.fetchBranches).not.toHaveBeenCalled();
  });
});
