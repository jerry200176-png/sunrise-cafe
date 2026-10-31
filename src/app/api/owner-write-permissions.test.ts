import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSignedAdminSession } from "@/lib/admin-api-auth";

const writes = vi.hoisted(() => ({
  insertBranch: vi.fn(async () => {}), updateBranch: vi.fn(async () => {}), setBranchArchived: vi.fn(async () => {}),
  insertRoom: vi.fn(async () => {}), updateRoom: vi.fn(async () => {}), deleteRoom: vi.fn(async () => {}),
  updateSettings: vi.fn(async () => {}),
}));
vi.mock("@/lib/supabase-fetch", () => ({
  ...writes,
  fetchBranches: vi.fn(), fetchPublicBranches: vi.fn(), fetchRooms: vi.fn(), fetchSettings: vi.fn(),
}));
import { POST as createBranch } from "./branches/route";
import { PATCH as updateBranch, DELETE as archiveBranch } from "./branches/[id]/route";
import { POST as createRoom } from "./rooms/route";
import { PATCH as updateRoom, DELETE as deleteRoom } from "./rooms/[id]/route";
import { PATCH as updateSettings } from "./settings/route";

const cases = [
  { label: "建立分店", path: "/api/branches", method: "POST", body: { name: "test" }, call: createBranch, write: writes.insertBranch },
  { label: "修改分店付款資訊", path: "/api/branches/other", method: "PATCH", body: { payment_info: "synthetic" }, call: updateBranch, write: writes.updateBranch },
  { label: "封存分店", path: "/api/branches/other", method: "DELETE", call: archiveBranch, write: writes.setBranchArchived },
  { label: "建立包廂", path: "/api/rooms", method: "POST", body: { branch_id: "other", name: "test", capacity: 2, price_weekday: 1, price_weekend: 1 }, call: createRoom, write: writes.insertRoom },
  { label: "修改包廂", path: "/api/rooms/other", method: "PATCH", body: { price_weekday: 1 }, call: updateRoom, write: writes.updateRoom },
  { label: "刪除包廂", path: "/api/rooms/other", method: "DELETE", call: deleteRoom, write: writes.deleteRoom },
  { label: "修改全站設定", path: "/api/settings", method: "PATCH", body: { deposit_info: "synthetic" }, call: updateSettings, write: writes.updateSettings },
] as const;

async function request(path: string, method: string, body: object | undefined, role?: "finance" | "staff" | "branch_manager" | "owner") {
  const cookie = role ? `admin_session=${await createSignedAdminSession("test-session", 3600, { role, sub: "test-user", branch_ids: role === "owner" ? null : ["allowed"] })}` : "";
  return new NextRequest(`http://localhost${path}`, { method, headers: { cookie, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const params = { params: Promise.resolve({ id: "other" }) };

describe("分店、包廂及全站設定寫入遵守 owner 權限", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "test-admin");
    vi.stubEnv("SESSION_SECRET", "test-session");
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(cases)("$label 拒絕未登入和所有非 owner 角色，且不寫入", async (item) => {
    const body = "body" in item ? item.body : undefined;
    expect((await item.call(await request(item.path, item.method, body), params)).status).toBe(401);
    for (const role of ["finance", "staff", "branch_manager"] as const) {
      const response = await item.call(await request(item.path, item.method, body, role), params);
      expect(response.status).toBe(403);
    }
    expect(item.write).not.toHaveBeenCalled();
  });

  it.each(cases)("$label 允許 owner", async (item) => {
    const body = "body" in item ? item.body : undefined;
    const response = await item.call(await request(item.path, item.method, body, "owner"), params);
    expect(response.status).toBe(200);
    expect(item.write).toHaveBeenCalledOnce();
  });

  it("設定更新保留未指定分店，並允許明確清除", async () => {
    await updateSettings(await request("/api/settings", "PATCH", { deposit_info: "synthetic" }, "owner"));
    expect(writes.updateSettings).toHaveBeenNthCalledWith(1, undefined, undefined, undefined, "synthetic", undefined, undefined);
    await updateSettings(await request("/api/settings", "PATCH", { current_branch_id: null }, "owner"));
    expect(writes.updateSettings).toHaveBeenNthCalledWith(2, null, undefined, undefined, undefined, undefined, undefined);
  });
});
