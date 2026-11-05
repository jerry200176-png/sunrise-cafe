import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createSignedAdminSession } from "@/lib/admin-api-auth";

const tableId = "11111111-1111-4111-8111-111111111111";
const store = vi.hoisted(() => ({
  from: vi.fn(),
  row: null as null | Record<string, unknown>,
  failScope: false,
  failWrite: false,
  throwWrite: false,
  beforeWrite: null as null | (() => void),
  writes: 0,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: store.from }) }));
import { PATCH } from "./route";

function query() {
  let patch: Record<string, unknown> | null = null;
  const filters: Array<[string, unknown]> = [];
  return {
    select() { return this; },
    update(values: Record<string, unknown>) { patch = values; return this; },
    eq(column: string, value: unknown) { filters.push([column, value]); return this; },
    async maybeSingle() {
      if (patch) {
        store.writes += 1;
        store.beforeWrite?.();
        if (store.throwWrite) throw new Error("synthetic private database detail");
        if (store.failWrite) return { data: null, error: { message: "synthetic private database detail" } };
        if (!store.row || !filters.every(([key, value]) => store.row?.[key] === value)) {
          return { data: null, error: null };
        }
        Object.assign(store.row, patch);
        return { data: { id: store.row.id, number: store.row.number, is_active: store.row.is_active }, error: null };
      }
      if (store.failScope) return { data: null, error: { message: "synthetic private database detail" } };
      const matches = store.row && filters.every(([key, value]) => store.row?.[key] === value);
      return { data: matches ? { branch_id: store.row?.branch_id } : null, error: null };
    },
  };
}

const expected = { number: "A1", is_active: true };
const context = (id = tableId) => ({ params: Promise.resolve({ id }) });
async function request(body: unknown, role?: "staff" | "finance" | "owner", branchIds = ["branch-a"]) {
  const cookie = role
    ? `admin_session=${await createSignedAdminSession("test-session", 3600, { role, sub: "test-user", branch_ids: role === "owner" ? null : branchIds })}`
    : "";
  return new NextRequest(`http://localhost/api/admin/tables/${tableId}`, {
    method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("ADMIN_PASSWORD", "test-password");
  vi.stubEnv("SESSION_SECRET", "test-session");
  vi.clearAllMocks();
  store.row = { id: tableId, branch_id: "branch-a", number: "A1", is_active: true, qr_token: "fake-qr", history: "preserved" };
  store.failScope = false;
  store.failWrite = false;
  store.throwWrite = false;
  store.beforeWrite = null;
  store.writes = 0;
  store.from.mockImplementation(() => query());
});
afterEach(() => vi.unstubAllEnvs());

describe("PATCH table identity and branch scope", () => {
  it("rejects unauthenticated and finance requests before the database is queried", async () => {
    expect((await PATCH(await request({ expected, is_active: false }), context())).status).toBe(401);
    expect((await PATCH(await request({ expected, is_active: false }, "finance"), context())).status).toBe(403);
    expect(store.from).not.toHaveBeenCalled();
  });

  it("does not reveal another branch's table or write to it", async () => {
    const response = await PATCH(await request({ expected, is_active: false }, "staff", ["branch-b"]), context());
    expect(response.status).toBe(404);
    expect(store.writes).toBe(0);
  });

  it.each(["staff", "owner"] as const)("lets %s edit an authorized table without changing its identity or QR", async (role) => {
    const response = await PATCH(await request({ expected, number: "  B2  " }, role), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: tableId, number: "B2", is_active: true });
    expect(store.row).toMatchObject({ branch_id: "branch-a", qr_token: "fake-qr", history: "preserved" });
  });

  it("soft-disables and re-enables the same table", async () => {
    const disabled = await PATCH(await request({ expected, is_active: false }, "staff"), context());
    expect(disabled.status).toBe(200);
    expect(store.row).toMatchObject({ id: tableId, branch_id: "branch-a", is_active: false, qr_token: "fake-qr", history: "preserved" });
    const enabled = await PATCH(await request({ expected: { number: "A1", is_active: false }, is_active: true }, "staff"), context());
    expect(enabled.status).toBe(200);
    expect(store.row?.is_active).toBe(true);
  });

  it.each([
    {},
    { expected },
    { expected, is_active: "false" },
    { expected, number: " " },
    { expected, number: "a".repeat(41) },
    { expected, number: "A\nB" },
    { expected: { number: "A1" }, is_active: false },
    { expected: { ...expected, branch_id: "branch-a" }, is_active: false },
    { expected, is_active: false, branch_id: "branch-b" },
    { expected, is_active: false, qr_token: "attacker-token" },
  ])("rejects invalid or unauthorized fields before an update", async (body) => {
    const response = await PATCH(await request(body, "staff"), context());
    expect(response.status).toBe(400);
    expect(store.writes).toBe(0);
  });

  it("rejects an invalid id and handles invalid JSON", async () => {
    expect((await PATCH(await request({ expected, is_active: false }, "staff"), context("invalid"))).status).toBe(400);
    const token = await createSignedAdminSession("test-session", 3600, { role: "owner", sub: "test-user", branch_ids: null });
    const malformed = new NextRequest(`http://localhost/api/admin/tables/${tableId}`, {
      method: "PATCH", headers: { cookie: `admin_session=${token}` }, body: "{",
    });
    expect((await PATCH(malformed, context())).status).toBe(400);
    expect(store.writes).toBe(0);
  });

  it("returns 409 when the original label or active status is stale", async () => {
    store.row!.number = "B2";
    const response = await PATCH(await request({ expected, is_active: false }, "staff"), context());
    expect(response.status).toBe(409);
    expect(store.row).toMatchObject({ number: "B2", is_active: true, qr_token: "fake-qr" });
  });

  it("rejects a concurrent branch change between authorization and update", async () => {
    store.beforeWrite = () => { store.row!.branch_id = "branch-b"; };
    const response = await PATCH(await request({ expected, is_active: false }, "staff"), context());
    expect(response.status).toBe(409);
    expect(store.row).toMatchObject({ branch_id: "branch-b", is_active: true, qr_token: "fake-qr" });
  });

  it("allows at most one of two concurrent writes against the same state", async () => {
    const first = await request({ expected, number: "B2" }, "staff");
    const second = await request({ expected, is_active: false }, "staff");
    const results = await Promise.all([PATCH(first, context()), PATCH(second, context())]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(store.row).toMatchObject(results[0].status === 200
      ? { number: "B2", is_active: true }
      : { number: "A1", is_active: false });
    expect(store.row).toMatchObject({ id: tableId, branch_id: "branch-a", qr_token: "fake-qr", history: "preserved" });
  });

  it.each(["scope", "write", "throw"])("does not leak database errors from %s failures", async (failure) => {
    store.failScope = failure === "scope";
    store.failWrite = failure === "write";
    store.throwWrite = failure === "throw";
    const response = await PATCH(await request({ expected, is_active: false }, "staff"), context());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("synthetic private database detail");
  });
});
