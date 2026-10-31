import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  denied: null as Response | null,
  readDenied: null as string | null,
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requireAdminApiAuth: async () => mocks.denied,
  getAdminContext: async () => ({}),
}));
vi.mock("@/lib/reservation-access", () => ({ assertReservationReadAllowed: () => mocks.readDenied }));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: () => true, insertReservationAdmin: vi.fn(), fetchRoom: vi.fn() }));
vi.mock("@/lib/reservation-list-query", async (orig) => ({
  ...(await orig<typeof import("@/lib/reservation-list-query")>()),
  listReservationsForAdmin: mocks.list,
}));

import { GET } from "./route";

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/reservations?${qs}`));

describe("GET /api/reservations (admin list)", () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.denied = null;
    mocks.readDenied = null;
  });

  it("asks old open admin tabs to reload instead of returning the unbounded list", async () => {
    const res = await get("branchId=b1");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "後台已更新，請重新整理頁面" });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("passes parsed scope, filters and cursor to the scoped query and returns its envelope", async () => {
    mocks.list.mockResolvedValue({ scope: "history", items: [{ id: "a" }], nextCursor: "c2", total: 7, warnings: ["x"] });
    const res = await get("branchId=b1&scope=history&range=7d&status=no_show&q=%E7%8E%8B&limit=20");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scope: "history", items: [{ id: "a" }], nextCursor: "c2", total: 7, warnings: ["x"] });
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: "b1", scope: "history", range: "7d", status: "no_show", q: "王", limit: 20 })
    );
  });

  it("keeps the branch permission check", async () => {
    mocks.readDenied = "Forbidden";
    const res = await get("branchId=b1&scope=active");
    expect(res.status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("reports a failed main query as 500 with the message", async () => {
    mocks.list.mockRejectedValue(new Error("Supabase reservations error: timeout"));
    const res = await get("branchId=b1&scope=active");
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("timeout");
  });
});
