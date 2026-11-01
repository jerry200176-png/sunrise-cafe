import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ byId: vi.fn(), byCredentials: vi.fn(), retrieve: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ fetchReservationById: m.byId, fetchReservationByPhoneAndCode: m.byCredentials }));
vi.mock("@/lib/guest-rate-limit", () => ({ enforceGuestLookupLimit: async () => null }));
vi.mock("@/lib/stripe", () => ({ isStripeEnabled: () => true, stripe: { paymentIntents: { retrieve: m.retrieve, create: m.create } } }));
vi.mock("@/lib/ops-log", () => ({ logOps: vi.fn() }));
import { signLookupToken } from "@/lib/lookup-token";
import { POST as confirm } from "./confirm-deposit/route";

const request = (credential: object) => new NextRequest("http://localhost/api/payment/confirm-deposit", {
  method: "POST", body: JSON.stringify({ paymentIntentId: "pi_fixture", reservationId: "res_1", ...credential }),
});
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("GUEST_LOOKUP_SECRET", "synthetic-test-secret"); m.retrieve.mockResolvedValue({ status: "processing" }); });
afterEach(() => vi.unstubAllEnvs());

it("accepts a token only for its reservation and performs lookup before provider access", async () => {
  m.byId.mockResolvedValue({ id: "res_1" });
  expect((await confirm(request({ token: signLookupToken("res_1") }))).status).toBe(200);
  expect(m.byId).toHaveBeenCalledWith("res_1");
  expect(m.retrieve).toHaveBeenCalledTimes(1);
  expect(m.byId.mock.invocationCallOrder[0]).toBeLessThan(m.retrieve.mock.invocationCallOrder[0]);
});
it("rejects another booking's signed token even with valid fallback credentials supplied", async () => {
  m.byCredentials.mockResolvedValue({ id: "res_1" });
  expect((await confirm(request({ token: signLookupToken("res_2"), phone: "0900000000", bookingCode: "ABC123" }))).status).toBe(400);
  expect(m.byCredentials).not.toHaveBeenCalled();
  expect(m.retrieve).not.toHaveBeenCalled();
});
it("authenticates phone and code when the token is absent", async () => {
  m.byCredentials.mockResolvedValue({ id: "res_1" });
  expect((await confirm(request({ phone: "0900000000", bookingCode: "ABC123" }))).status).toBe(200);
  expect(m.byCredentials).toHaveBeenCalledWith("0900000000", "ABC123");
  expect(m.retrieve).toHaveBeenCalledTimes(1);
});
it("does not call Stripe when the real guest lookup throws", async () => {
  m.byId.mockRejectedValue(new Error("SYNTHETIC_GUEST_PRIVATE"));
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await confirm(request({ token: signLookupToken("res_1") }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("SYNTHETIC_GUEST_PRIVATE");
    expect(JSON.stringify(stderr.mock.calls)).not.toContain("SYNTHETIC_GUEST_PRIVATE");
    expect(m.retrieve).not.toHaveBeenCalled();
  } finally { stderr.mockRestore(); }
});
