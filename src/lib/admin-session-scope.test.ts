import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSignedAdminSession, getAdminContext } from "./admin-api-auth";
import { canAccessBranch, filterBranchIds, hasPermission, resolveBranchScope } from "./rbac";
import { paymentEventInScope } from "./payment-event-scope";
import type { AdminRole } from "./rbac";

async function context(claims?: Parameters<typeof createSignedAdminSession>[2]) {
  const token = await createSignedAdminSession("test-secret", 3600, claims);
  return getAdminContext(new NextRequest("http://localhost", { headers: { cookie: `admin_session=${token}` } }));
}

describe("signed session 的分店範圍", () => {
  beforeEach(() => { vi.stubEnv("ADMIN_PASSWORD", "test-admin"); vi.stubEnv("SESSION_SECRET", "test-secret"); });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["finance", "staff", "branch_manager"] as const)("%s 的 null 或省略 branch_ids 均無跨店權限", async (role) => {
    const permission = role === "finance" ? "payments:read" : "reservations:read";
    for (const branch_ids of [null, undefined]) {
      const ctx = await context({ role, sub: "synthetic-user", branch_ids });
      expect(ctx.branch_ids).toEqual([]);
      expect(canAccessBranch(ctx, "other")).toBe(false);
      expect(hasPermission(ctx, permission, "other")).toBe(false);
      expect(resolveBranchScope(ctx, null)).toEqual({ ok: true, scope: [] });
    }
  });
  it("分店名單及 owner、舊版 owner 的無限制範圍保留原樣", async () => {
    const scoped = await context({ role: "finance", sub: "synthetic-user", branch_ids: ["allowed"] });
    expect(hasPermission(scoped, "payments:read", "allowed")).toBe(true);
    expect(hasPermission(scoped, "payments:read", "foreign")).toBe(false);
    for (const claims of [{ role: "owner" as const, branch_ids: null }, undefined, { legacy: true }]) {
      const owner = await context(claims);
      expect(owner.role).toBe("owner");
      expect(owner.branch_ids).toBeNull();
      expect(hasPermission(owner, "payments:read", "foreign")).toBe(true);
    }
  });
  it("直接傳入錯誤的 non-owner null context 時，共用 helper 也拒絕跨店", async () => {
    const invalid = { user_id: "synthetic", role: "finance" as const, branch_ids: null, legacy: false };
    expect(canAccessBranch(invalid, "foreign")).toBe(false);
    expect(hasPermission(invalid, "payments:read", "foreign")).toBe(false);
    expect(filterBranchIds(invalid, ["foreign"])).toEqual([]);
    expect(resolveBranchScope(invalid, null)).toEqual({ ok: true, scope: [] });
    expect(resolveBranchScope(invalid, "foreign")).toEqual({ ok: false });
    expect(await paymentEventInScope("synthetic-event", invalid)).toBe(false);
    expect(await paymentEventInScope("synthetic-event", { ...invalid, role: "owner" })).toBe(true);
  });
  it("不明角色即使持有有效簽章，也不提升為 owner", async () => {
    for (const role of ["unexpected", "none", "OWNER", ""]) {
      const ctx = await context({ role: role as AdminRole, sub: "synthetic-user", branch_ids: null });
      expect(ctx.role).toBe("none");
      expect(ctx.branch_ids).toEqual([]);
      expect(hasPermission(ctx, "payments:approve", "foreign")).toBe(false);
    }
    const emptyRoleWithoutSub = await context({ role: "" as AdminRole, branch_ids: null });
    expect(emptyRoleWithoutSub.role).toBe("none");
    expect(hasPermission(emptyRoleWithoutSub, "payments:approve", "foreign")).toBe(false);
  });
});
