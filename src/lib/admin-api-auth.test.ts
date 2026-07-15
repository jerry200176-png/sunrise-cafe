import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSession,
  requireAdminApiAuth,
  createSignedAdminSession,
  isReservationMutationPath,
  isAdminOnlyApiPath,
  isAdminAuthRequired,
  getAdminContext,
} from "./admin-api-auth";
import { hasPermission } from "./rbac";

const origPassword = process.env.ADMIN_PASSWORD;
const origSession = process.env.SESSION_SECRET;
const origNodeEnv = process.env.NODE_ENV;
const origVercelEnv = process.env.VERCEL_ENV;

afterEach(() => {
  process.env.ADMIN_PASSWORD = origPassword;
  process.env.SESSION_SECRET = origSession;
  process.env.NODE_ENV = origNodeEnv;
  process.env.VERCEL_ENV = origVercelEnv;
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

describe("isAdminOnlyApiPath (RC2 P2)", () => {
  it("includes reservation mutations", () => {
    expect(isAdminOnlyApiPath("/api/reservations/x", "PATCH")).toBe(true);
  });

  it("protects GET /api/reservations list", () => {
    expect(isAdminOnlyApiPath("/api/reservations", "GET")).toBe(true);
    expect(isAdminOnlyApiPath("/api/reservations", "POST")).toBe(false);
  });

  it("protects send-line and recurring admin", () => {
    expect(isAdminOnlyApiPath("/api/reservations/send-line", "POST")).toBe(true);
    expect(isAdminOnlyApiPath("/api/reservations/recurring/admin", "POST")).toBe(true);
  });

  it("protects branch and settings mutations", () => {
    expect(isAdminOnlyApiPath("/api/branches/uuid", "PATCH")).toBe(true);
    expect(isAdminOnlyApiPath("/api/branches/uuid", "DELETE")).toBe(true);
    expect(isAdminOnlyApiPath("/api/settings", "PATCH")).toBe(true);
    expect(isAdminOnlyApiPath("/api/settings", "GET")).toBe(false);
  });

  it("protects branch/room create and recurring guest path", () => {
    expect(isAdminOnlyApiPath("/api/branches", "POST")).toBe(true);
    expect(isAdminOnlyApiPath("/api/rooms", "POST")).toBe(true);
    expect(isAdminOnlyApiPath("/api/rooms/uuid", "PATCH")).toBe(true);
    expect(isAdminOnlyApiPath("/api/rooms/uuid", "DELETE")).toBe(true);
    expect(isAdminOnlyApiPath("/api/reservations/recurring", "POST")).toBe(true);
    expect(isAdminOnlyApiPath("/api/diagnose", "GET")).toBe(true);
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

describe("isAdminAuthRequired", () => {
  it("requires auth when ADMIN_PASSWORD is set", () => {
    process.env.ADMIN_PASSWORD = "pw";
    delete process.env.VERCEL_ENV;
    expect(isAdminAuthRequired()).toBe(true);
  });

  it("requires auth in production even without ADMIN_PASSWORD", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.NODE_ENV = "production";
    expect(isAdminAuthRequired()).toBe(true);
  });

  it("allows dev mode without password", () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    expect(isAdminAuthRequired()).toBe(false);
  });
});

describe("getAdminContext", () => {
  it("does not elevate to owner when auth required and cookie missing", async () => {
    process.env.ADMIN_PASSWORD = "pw";
    process.env.SESSION_SECRET = "sess";
    const req = new NextRequest("http://localhost/api/admin/me");
    const ctx = await getAdminContext(req);
    expect(ctx.role).toBe("none");
    expect(hasPermission(ctx, "reservations:read")).toBe(false);
    expect(hasPermission(ctx, "payments:approve")).toBe(false);
  });

  it("does not elevate to owner when signature invalid", async () => {
    process.env.ADMIN_PASSWORD = "pw";
    process.env.SESSION_SECRET = "sess";
    const req = new NextRequest("http://localhost/api/admin/me", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=tampered.sig` },
    });
    const ctx = await getAdminContext(req);
    expect(ctx.role).toBe("none");
  });

  it("returns owner in legacy mode when auth not required", async () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    const req = new NextRequest("http://localhost/api/admin/me");
    const ctx = await getAdminContext(req);
    expect(ctx.role).toBe("owner");
    expect(ctx.legacy).toBe(true);
  });
});

describe("requireAdminApiAuth", () => {
  it("allows when admin auth not required (dev mode)", async () => {
    delete process.env.ADMIN_PASSWORD;
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;
    const req = new NextRequest("http://localhost/api/reservations/x", { method: "PATCH" });
    expect(await requireAdminApiAuth(req)).toBeNull();
  });

  it("returns 503 in production when no signing key configured", async () => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = "production";
    const req = new NextRequest("http://localhost/api/reservations/x", { method: "PATCH" });
    const res = await requireAdminApiAuth(req);
    expect(res?.status).toBe(503);
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
