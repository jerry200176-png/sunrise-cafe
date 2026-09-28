import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import * as adminAuth from "@/lib/admin-api-auth";

const PUBLIC_ROW = { id: "b1", name: "昇咖啡 大安店", display_name: "昇昇咖啡 (大安店)" };
const FULL_ROW = { ...PUBLIC_ROW, line_group_id: "Cgroup", payment_info: "銀行…", line_pay_url: "https://pay" };

vi.mock("@/lib/supabase-fetch", () => ({
  fetchPublicBranches: vi.fn(async () => [PUBLIC_ROW]),
  fetchBranches: vi.fn(async () => [FULL_ROW]),
  insertBranch: vi.fn(async () => {}),
}));

describe("GET /api/branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives guests only the public branch fields", async () => {
    vi.spyOn(adminAuth, "hasValidAdminSession").mockResolvedValue(false);
    const res = await GET(new NextRequest("https://test.local/api/branches"));
    const body = await res.json();
    expect(body).toEqual([PUBLIC_ROW]);
    expect(body[0]).not.toHaveProperty("line_group_id");
    expect(body[0]).not.toHaveProperty("payment_info");
  });

  // The admin editor pre-fills its form from this list and PATCHes every field back;
  // without the internal fields, saving a branch would clear its LINE group and payment info.
  it("gives an admin session the internal fields the branch editor saves back", async () => {
    vi.spyOn(adminAuth, "hasValidAdminSession").mockResolvedValue(true);
    const res = await GET(new NextRequest("https://test.local/api/branches"));
    expect(await res.json()).toEqual([FULL_ROW]);
  });
});
