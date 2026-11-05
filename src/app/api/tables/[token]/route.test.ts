import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, error: null as unknown }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: () => {
  const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: state.data, error: state.error }) };
  return chain;
} }) }));
import { GET } from "./route";
const get = () => GET(new NextRequest("http://localhost/api/tables/qr"), { params: Promise.resolve({ token: "qr" }) });
describe("QR table branch archive guard", () => {
  beforeEach(() => { state.data = { id: "t", number: "1", branch_id: "b", is_active: true, branches: { name: "branch", archived_at: null } }; state.error = null; });
  it("returns active table without leaking internal archive field", async () => {
    const res = await get(); expect(res.status).toBe(200); expect((await res.json()).branches).toEqual({ name: "branch" });
  });
  it("rejects an archived branch", async () => { state.data!.branches = { name: "branch", archived_at: "2026-01-01" }; expect((await get()).status).toBe(403); });
  it("fails closed for unavailable branch state and query failure", async () => {
    state.data!.branches = { name: "branch" }; expect((await get()).status).toBe(503);
    state.data!.branches = null; expect((await get()).status).toBe(503);
    state.error = { message: "database failure" }; expect((await get()).status).not.toBe(200);
  });
});
