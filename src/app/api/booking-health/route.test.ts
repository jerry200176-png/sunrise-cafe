import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: () => true, fetchBranch: vi.fn(), getBlockedSlots: vi.fn() }));
vi.mock("@/lib/admin-api-auth", () => ({ hasValidAdminSession: async () => false }));
vi.mock("@/lib/rate-limit", () => ({ getRateLimitMode: () => "upstash" }));
vi.mock("@/lib/stripe", () => ({ isStripeEnabled: () => false }));
import { GET } from "./route";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("does not claim verified distributed limiting from environment settings", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
  const response = await GET(new NextRequest("https://test.local/api/booking-health"));
  expect(await response.json()).toMatchObject({ ok: true, rate_limit_mode: "upstash", rate_limit_grade: "configured_unverified" });
});
