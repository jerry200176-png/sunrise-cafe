import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/admin-api-auth", () => ({ requirePermission: async () => null }));
import { GET } from "./route";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("orders query with the actual PostgREST client", () => {
  it("sends ordered keyset filters, exact counts and the authorized branch", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic");
    const mockFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([
      { id: "00000000-0000-0000-0000-000000000002", created_at: "2026-10-31T10:00:00.123456+00:00" },
      { id: "00000000-0000-0000-0000-000000000001", created_at: null },
    ]), { status: 200, headers: { "content-type": "application/json", "content-range": "0-1/2" } }));
    vi.stubGlobal("fetch", mockFetch);
    const first = await GET(new NextRequest("http://localhost/api/admin/orders?branchId=b1&limit=1&scope=active"));
    expect(first.status).toBe(200);
    const { nextCursor } = await first.json();
    const next = await GET(new NextRequest(`http://localhost/api/admin/orders?branchId=b1&limit=1&scope=active&cursor=${nextCursor}`));
    expect(next.status).toBe(200);
    const url = new URL(String(mockFetch.mock.calls[1][0]));
    expect(url.searchParams.get("branch_id")).toBe("eq.b1");
    expect(url.searchParams.get("status")).toBe("in.(pending,preparing,ready)");
    expect(url.searchParams.get("order")).toBe("created_at.desc.nullslast,id.desc");
    expect(url.searchParams.get("or")).toContain("123456+00:00");
    expect(new Headers(mockFetch.mock.calls[1][1]?.headers).get("prefer")).toContain("count=exact");
  });

  it("filters 5001 historical records while retaining a recent unprinted order with delayed items", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic");
    const data = Array.from({ length: 5001 }, (_, i) => ({ id: `history-${i}`, branch_id: "b1", created_at: "2020-01-01T00:00:00.000Z", status: "completed", is_printed: true, order_items: [] }));
    data.push({ id: "00000000-0000-0000-0000-000000000001", branch_id: "b1", created_at: "2026-10-31T09:59:00.000Z", status: "pending", is_printed: false, order_items: [] });
    const mockFetch = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("branch_id")).toBe("eq.b1");
      expect(url.searchParams.get("is_printed")).toBe("eq.false");
      expect(url.searchParams.get("status")).toBe("in.(pending,preparing,ready)");
      const cutoff = url.searchParams.get("created_at")?.slice(4);
      expect(cutoff).toBe("2026-10-31T02:00:00.000Z");
      const matched = data.filter((row) => row.branch_id === "b1" && !row.is_printed && row.status !== "completed" && row.created_at >= cutoff!);
      return new Response(JSON.stringify(matched), { headers: { "content-type": "application/json", "content-range": `0-${matched.length - 1}/${matched.length}` } });
    });
    vi.stubGlobal("fetch", mockFetch);
    const response = await GET(new NextRequest("http://localhost/api/admin/orders?branchId=b1&scope=printable&since=2026-10-31T02%3A00%3A00.000Z&limit=100"));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].order_items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});
