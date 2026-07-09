import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSession,
  requireAdminApiAuth,
  createSignedAdminSession,
  isReservationMutationPath,
} from "./admin-api-auth";

const origPassword = process.env.ADMIN_PASSWORD;
const origSession = process.env.SESSION_SECRET;

afterEach(() => {
  process.env.ADMIN_PASSWORD = origPassword;
  process.env.SESSION_SECRET = origSession;
});

describe("isReservationMutationPath", () => {
  it("PATCH/DELETE on /api/reservations/:id match", () => {
    expect(isReservationMutationPath("/api/reservations/abc-123", "PATCH")).toBe(true);
    expect(isReservationMutationPath("/api/reservations/abc-123", "DELETE")).toBe(true);
  });

  it("GET/POST and other paths do not match", () => {
    expect(isReservationMutationPath("/api/reservations/abc-123", "GET")).toBe(false);
    expect(isReservationMutationPath("/api/reservations", "PATCH")).toBe(false);
    expect(isReservationMutationPath("/api/reservations/send-line", "POST")).toBe(false);
  });
});

describe("verifyAdminSession", () => {
  it("accepts a valid signed session", async () => {
    const secret = "test-secret-key";
    const token = await createSignedAdminSession(secret);
    expect(await verifyAdminSession(token, secret)).toBe(true);
  });

  it("rejects tampered signature", async () => {
    const secret = "test-secret-key";
    const token = await createSignedAdminSession(secret);
    const tampered = token.slice(0, -2) + "xx";
    expect(await verifyAdminSession(tampered, secret)).toBe(false);
  });

  it("rejects expired session", async () => {
    const secret = "test-secret-key";
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ iat: now - 1000, exp: now - 1 });
    const encoded = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
    const bytes = new Uint8Array(sigBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const sig = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyAdminSession(`${encoded}.${sig}`, secret)).toBe(false);
  });
});

describe("requireAdminApiAuth", () => {
  it("allows when ADMIN_PASSWORD is unset (dev mode)", async () => {
    delete process.env.ADMIN_PASSWORD;
    const req = new NextRequest("http://localhost/api/reservations/x", { method: "PATCH" });
    expect(await requireAdminApiAuth(req)).toBeNull();
  });

  it("returns 401 when no cookie", async () => {
    process.env.ADMIN_PASSWORD = "pw";
    process.env.SESSION_SECRET = "sess";
    const req = new NextRequest("http://localhost/api/reservations/x", { method: "PATCH" });
    const res = await requireAdminApiAuth(req);
    expect(res?.status).toBe(401);
  });

  it("returns 401 for invalid cookie", async () => {
    process.env.ADMIN_PASSWORD = "pw";
    process.env.SESSION_SECRET = "sess";
    const req = new NextRequest("http://localhost/api/reservations/x", {
      method: "PATCH",
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=not.valid` },
    });
    const res = await requireAdminApiAuth(req);
    expect(res?.status).toBe(401);
  });

  it("returns null for valid admin session", async () => {
    process.env.ADMIN_PASSWORD = "pw";
    process.env.SESSION_SECRET = "sess";
    const token = await createSignedAdminSession("sess");
    const req = new NextRequest("http://localhost/api/reservations/x", {
      method: "PATCH",
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
    });
    expect(await requireAdminApiAuth(req)).toBeNull();
  });
});
