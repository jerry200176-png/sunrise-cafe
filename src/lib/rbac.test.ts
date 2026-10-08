import { describe, expect, it } from "vitest";
import {
  canAccessBranch,
  deniedContext,
  filterBranchIds,
  hasPermission,
  ownerContext,
  roleHasPermission,
} from "./rbac";

describe("rbac", () => {
  const manager = {
    user_id: "u1",
    role: "branch_manager" as const,
    branch_ids: ["b1", "b2"],
    legacy: false,
  };

  it("owner has all permissions", () => {
    expect(roleHasPermission("owner", "users:manage")).toBe(true);
    expect(hasPermission(ownerContext(), "payments:approve", "any")).toBe(true);
  });

  it("branch_manager scoped to assigned branches", () => {
    expect(hasPermission(manager, "reservations:read", "b1")).toBe(true);
    expect(hasPermission(manager, "reservations:read", "b3")).toBe(false);
    expect(hasPermission(manager, "users:manage", "b1")).toBe(false);
  });

  it("staff cannot approve payments", () => {
    const staff = {
      user_id: "s1",
      role: "staff" as const,
      branch_ids: ["b1"],
      legacy: false,
    };
    expect(hasPermission(staff, "payments:approve", "b1")).toBe(false);
    expect(hasPermission(staff, "payments:read", "b1")).toBe(false);
  });

  it("staff and branch managers can send messages only in scope", () => {
    const staff = {
      user_id: "s1",
      role: "staff" as const,
      branch_ids: ["b1"],
      legacy: false,
    };
    expect(hasPermission(staff, "reservations:message_send", "b1")).toBe(true);
    expect(hasPermission(staff, "reservations:message_send", "b2")).toBe(false);
    expect(hasPermission(manager, "reservations:message_send", "b2")).toBe(true);
  });

  it("finance cannot send reservation messages", () => {
    const finance = {
      user_id: "f1",
      role: "finance" as const,
      branch_ids: ["b1"],
      legacy: false,
    };
    expect(hasPermission(finance, "reservations:message_send", "b1")).toBe(false);
  });

  it("finance can read payments not write reservations", () => {
    const finance = {
      user_id: "f1",
      role: "finance" as const,
      branch_ids: ["b1"],
      legacy: false,
    };
    expect(hasPermission(finance, "payments:read", "b1")).toBe(true);
    expect(hasPermission(finance, "reservations:write", "b1")).toBe(false);
  });

  it("filterBranchIds respects scope", () => {
    expect(filterBranchIds(manager, ["b1", "b2", "b3"])).toEqual(["b1", "b2"]);
    expect(filterBranchIds(ownerContext(), ["b1", "b3"])).toEqual(["b1", "b3"]);
  });

  it("canAccessBranch for owner", () => {
    expect(canAccessBranch(ownerContext(), "x")).toBe(true);
  });

  it("deniedContext has zero permissions", () => {
    const denied = deniedContext();
    expect(denied.role).toBe("none");
    expect(hasPermission(denied, "reservations:read")).toBe(false);
    expect(hasPermission(denied, "payments:approve", "b1")).toBe(false);
    expect(canAccessBranch(denied, "b1")).toBe(false);
  });
});

import { resolveBranchScope } from "./rbac";

describe("resolveBranchScope", () => {
  const mgr = { user_id: "u", role: "branch_manager" as const, branch_ids: ["b1"], legacy: false };
  it("requested branch must be allowed", () => {
    expect(resolveBranchScope(mgr, "b1")).toEqual({ ok: true, scope: ["b1"] });
    expect(resolveBranchScope(mgr, "b2")).toEqual({ ok: false });
  });
  it("no request = allowed set; owner = unrestricted; denied = empty", () => {
    expect(resolveBranchScope(mgr, null)).toEqual({ ok: true, scope: ["b1"] });
    expect(resolveBranchScope({ ...mgr, role: "owner", branch_ids: null }, null)).toEqual({ ok: true, scope: null });
    expect(resolveBranchScope({ ...mgr, role: "none", branch_ids: [] }, null)).toEqual({ ok: true, scope: [] });
  });
});
