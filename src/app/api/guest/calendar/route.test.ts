import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
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

describe("/api/guest/calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "test-secret";
  });

  it("serves ics via GET with signed lookup token and zero phone in query", async () => {
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

  it("returns 410 Sunset when GET query contains phone parameter", async () => {
    const req = new NextRequest("https://test.local/api/guest/calendar?code=ABC123&phone=0912345678");
    const res = await GET(req);
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.sunset).toBe(true);
    expect(json.code).toBe("PHONE_URL_PARAM_RETIRED");
  });

  it("returns 400 for invalid token", async () => {
    const req = new NextRequest("https://test.local/api/guest/calendar?token=invalid.token");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("無效");
  });

  it("serves ics via POST body with token", async () => {
    const token = signLookupToken("res-token-post");
    mockSingle.mockResolvedValue({
      data: {
        booking_code: "POSTOK",
        phone: "0912345678",
        customer_name: "王先生",
        start_time: "2026-09-10T14:00:00+08:00",
        end_time: "2026-09-10T16:00:00+08:00",
        status: "confirmed",
        room: { name: "包廂 C" },
      },
      error: null,
    });

    const req = new NextRequest("https://test.local/api/guest/calendar", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("POSTOK");
  });

  it("POST body supports code + phone with unified 404 anti-enumeration", async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req1 = new NextRequest("https://test.local/api/guest/calendar", {
      method: "POST",
      body: JSON.stringify({ code: "NOTFOUND", phone: "0900000000" }),
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(404);
    const json1 = await res1.json();
    expect(json1.error).toBe("找不到符合的訂位，請確認電話與訂位代號");
  });
});
