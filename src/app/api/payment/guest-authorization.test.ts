import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mock = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), create: vi.fn(), retrieve: vi.fn(), database: vi.fn() }));
vi.mock("@/lib/guest-auth", () => ({ verifyGuestBookingByTokenOrCredentials: mock.auth }));
vi.mock("@/lib/guest-rate-limit", () => ({ enforceGuestLookupLimit: mock.limit }));
vi.mock("@/lib/stripe", () => ({ isStripeEnabled: () => true, stripe: { paymentIntents: { create: mock.create, retrieve: mock.retrieve } } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: mock.database }) }));
vi.mock("@/lib/ops-log", () => ({ logOps: vi.fn() }));
import { POST as create } from "./create-intent/route";
import { POST as confirm } from "./confirm-deposit/route";

const req = (path: string, body: object) => new NextRequest(`http://localhost/api/payment/${path}`, { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mock.limit.mockResolvedValue(null); });
afterEach(() => vi.unstubAllEnvs());

describe("payment guest authorization", () => {
  for (const [path, handler, body] of [
    ["create-intent", create, { reservationId: "r1", branchId: "daan", amount: 500, token: "invalid" }],
    ["confirm-deposit", confirm, { reservationId: "r1", paymentIntentId: "pi1", token: "invalid" }],
  ] as const) {
    it(`${path} rejects a guest without booking authority before provider or payment DB access`, async () => {
      mock.auth.mockResolvedValue({ ok: false, status: 400, error: "驗證失敗" });
      const res = await handler(req(path, body));
      expect(res.status).toBe(400);
      expect(mock.auth).toHaveBeenCalledWith(expect.objectContaining({ id: "r1", token: "invalid" }));
      expect(mock.create).not.toHaveBeenCalled();
      expect(mock.retrieve).not.toHaveBeenCalled();
      expect(mock.database).not.toHaveBeenCalled();
    });
    it(`${path} rejects tokens signed with the known development fallback in production`, async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GUEST_LOOKUP_SECRET", "");
      vi.stubEnv("SESSION_SECRET", "");
      vi.stubEnv("ADMIN_PASSWORD", "");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect((await handler(req(path, body))).status).toBe(503);
        expect(mock.auth).not.toHaveBeenCalled();
        expect(mock.create).not.toHaveBeenCalled();
        expect(mock.retrieve).not.toHaveBeenCalled();
      } finally { warn.mockRestore(); }
    });
    it(`${path} also rejects an explicitly configured public development signing value`, async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("GUEST_LOOKUP_SECRET", "  sunrise-guest-lookup-dev-secret  ");
      expect((await handler(req(path, body))).status).toBe(503);
      expect(mock.auth).not.toHaveBeenCalled();
      expect(mock.create).not.toHaveBeenCalled();
      expect(mock.retrieve).not.toHaveBeenCalled();
    });
    it(`${path} rejects invalid credential types before guest verification`, async () => {
      expect((await handler(req(path, { ...body, token: 123 }))).status).toBe(400);
      expect(mock.auth).not.toHaveBeenCalled();
      expect(mock.create).not.toHaveBeenCalled();
      expect(mock.retrieve).not.toHaveBeenCalled();
    });
    it(`${path} does not call the provider when auth or limiting throws`, async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        mock.auth.mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_DATA"));
        const authError = await handler(req(path, body));
        expect(authError.status).toBe(500);
        expect(await authError.text()).not.toContain("SYNTHETIC_PRIVATE_DATA");
        mock.limit.mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_DATA"));
        const limitError = await handler(req(path, body));
        expect(limitError.status).toBe(500);
        expect(await limitError.text()).not.toContain("SYNTHETIC_PRIVATE_DATA");
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain("SYNTHETIC_PRIVATE_DATA");
        expect(mock.create).not.toHaveBeenCalled();
        expect(mock.retrieve).not.toHaveBeenCalled();
      } finally { consoleError.mockRestore(); }
    });
    it(`${path} passes fallback booking credentials to the guest verifier`, async () => {
      mock.auth.mockResolvedValue({ ok: false, status: 404, error: "not found" });
      const credentials = { ...body, token: undefined, phone: "0900000000", bookingCode: "ABC123" };
      expect((await handler(req(path, credentials))).status).toBe(404);
      expect(mock.auth).toHaveBeenCalledWith({ id: "r1", token: null, phone: "0900000000", bookingCode: "ABC123" });
      expect(mock.create).not.toHaveBeenCalled();
      expect(mock.retrieve).not.toHaveBeenCalled();
    });
    it(`${path} enforces rate limit before guest verification`, async () => {
      mock.limit.mockResolvedValue(NextResponse.json({ error: "Too Many Requests" }, { status: 429 }));
      const res = await handler(req(path, body));
      expect(res.status).toBe(429);
      expect(mock.auth).not.toHaveBeenCalled();
      expect(mock.create).not.toHaveBeenCalled();
      expect(mock.retrieve).not.toHaveBeenCalled();
    });
  }
});
