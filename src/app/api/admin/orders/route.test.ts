import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), createClient: vi.fn(), calls: [] as Array<[string, ...unknown[]]>, results: [] as unknown[] }));
vi.mock("@/lib/admin-api-auth", () => ({ requirePermission: mocks.auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { GET } from "./route";

const row = (n: number, created_at: string | null = "2026-10-31T10:00:00.123456+00:00") => ({
  id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, created_at,
});
const req = (query: string) => new NextRequest(`http://localhost/api/admin/orders?${query}`);

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.results.length = 0;
  mocks.auth.mockReset().mockResolvedValue(null);
  const chain: Record<string, unknown> = {};
  for (const name of ["from", "select", "eq", "order", "limit", "or", "is", "lt", "in", "gte"]) {
    chain[name] = (...args: unknown[]) => { mocks.calls.push([name, ...args]); return chain; };
  }
  chain.then = (resolve: (value: unknown) => void) => resolve(mocks.results.shift());
  mocks.createClient.mockReset().mockReturnValue(chain);
});

describe("admin orders pagination", () => {
  it("keeps branch authorization before creating a database client", async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: "denied" }, { status: 403 }));
    expect((await GET(req("branchId=other&limit=1"))).status).toBe(403);
    expect(mocks.auth).toHaveBeenCalledWith(expect.anything(), "orders:read", "other");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("uses time and id keyset with microseconds and branch filter", async () => {
    mocks.results.push({ data: [row(3), row(2)], count: 2, error: null });
    const first = await (await GET(req("branchId=allowed&limit=1"))).json();
    expect(first.items).toEqual([row(3)]);
    mocks.results.push({ data: [row(2)], count: 1, error: null });
    const second = await (await GET(req(`branchId=allowed&limit=1&cursor=${first.nextCursor}`))).json();
    expect(second).toEqual({ items: [row(2)], nextCursor: null });
    expect(mocks.calls).toContainEqual(["eq", "branch_id", "allowed"]);
    expect(mocks.calls).toContainEqual(["order", "id", { ascending: false }]);
    expect(mocks.calls.some((c) => c[0] === "or" && String(c[1]).includes("123456+00:00") && String(c[1]).includes(row(3).id))).toBe(true);
    expect((await GET(req(`branchId=other&limit=1&cursor=${first.nextCursor}`))).status).toBe(400);
  });

  it("continues through null timestamps without losing records", async () => {
    mocks.results.push({ data: [row(3, null), row(2, null)], count: 2, error: null });
    const first = await (await GET(req("branchId=allowed&limit=1"))).json();
    mocks.results.push({ data: [row(2, null)], count: 1, error: null });
    expect((await GET(req(`branchId=allowed&limit=1&cursor=${first.nextCursor}`))).status).toBe(200);
    expect(mocks.calls).toContainEqual(["is", "created_at", null]);
    expect(mocks.calls).toContainEqual(["lt", "id", row(3).id]);
  });

  it("limits printable rows to the fixed recent window, active statuses and unprinted rows", async () => {
    mocks.results.push({ data: [row(3), row(2)], count: 2, error: null });
    const since = "2026-10-31T02:00:00.000Z";
    const first = await (await GET(req(`branchId=allowed&scope=printable&since=${encodeURIComponent(since)}&limit=1`))).json();
    expect(mocks.calls).toContainEqual(["eq", "is_printed", false]);
    expect(mocks.calls).toContainEqual(["gte", "created_at", since]);
    expect(mocks.calls).toContainEqual(["in", "status", ["pending", "preparing", "ready"]]);
    expect((await GET(req(`branchId=allowed&scope=printable&since=2026-10-31T03%3A00%3A00.000Z&limit=1&cursor=${first.nextCursor}`))).status).toBe(400);
  });

  it("rejects invalid cursor, excessive limit and silent server-side truncation", async () => {
    expect((await GET(req("branchId=allowed&limit=101"))).status).toBe(400);
    expect((await GET(req("branchId=allowed&cursor=invalid"))).status).toBe(400);
    mocks.results.push({ data: [row(3)], count: 2, error: null });
    expect((await GET(req("branchId=allowed&limit=1"))).status).toBe(503);
  });

  it("preserves the legacy array response by fetching each page", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => row(101 - index));
    mocks.results.push({ data: rows, count: 101, error: null }, { data: [rows[100]], count: 1, error: null });
    const response = await GET(req("branchId=allowed"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rows);
  });
});
