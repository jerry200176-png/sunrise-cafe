import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { signLookupToken } from "@/lib/lookup-token";

vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ success: true })),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

const mockSingle = vi.fn();
const mockEq = vi.fn(() => ({ maybeSingle: mockSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

describe("GET /api/guest/calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-secret";
  });

  it("serves ics via signed lookup token with zero phone in query", async () => {
    const token = signLookupToken("res-token-1");
    mockSingle.mockResolvedValue({
      data: {
        booking_code: "TOK123",
        phone: "0912345678",
        customer_name: "林小姐",
        start_time: "2026-09-10T14:00:00+08:00",
        end_time: "2026-09-10T16:00:00+08:00",
        status: "confirmed",
        room: { name: "包廂 A", branch: { name: "大安店" } },
      },
      error: null,
    });

    const req = new NextRequest(`https://test.local/api/guest/calendar?token=${encodeURIComponent(token)}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain("TOK123");
    expect(mockEq).toHaveBeenCalledWith("id", "res-token-1");
  });

  it("returns 400 for invalid token", async () => {
    const req = new NextRequest("https://test.local/api/guest/calendar?token=invalid.token");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("無效");
  });

  it("eliminates code enumeration oracle: returns unified 404 for missing code AND mismatched phone", async () => {
    // 1. Missing code returns 404
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req1 = new NextRequest("https://test.local/api/guest/calendar?code=NOTFOUND&phone=0900000000");
    const res1 = await GET(req1);
    expect(res1.status).toBe(404);
    const json1 = await res1.json();
    expect(json1.error).toBe("找不到符合的訂位，請確認電話與訂位代號");

    // 2. Existing code with wrong phone returns identical 404 (not 403!)
    mockSingle.mockResolvedValueOnce({
      data: {
        booking_code: "REAL99",
        phone: "0912345678",
        customer_name: "陳先生",
        start_time: "2026-09-10T14:00:00+08:00",
        end_time: "2026-09-10T16:00:00+08:00",
        status: "confirmed",
        room: { name: "包廂 B" },
      },
      error: null,
    });

    const req2 = new NextRequest("https://test.local/api/guest/calendar?code=REAL99&phone=0999999999");
    const res2 = await GET(req2);
    expect(res2.status).toBe(404);
    const json2 = await res2.json();
    expect(json2.error).toBe("找不到符合的訂位，請確認電話與訂位代號");
  });
});
