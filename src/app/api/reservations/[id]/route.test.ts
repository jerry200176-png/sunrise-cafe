import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createSignedAdminSession,
} from "@/lib/admin-api-auth";
import {
  updateReservationAdmin,
  deleteReservationAdmin,
} from "@/lib/supabase-admin";
import { PATCH, DELETE } from "./route";

vi.mock("@/lib/supabase-admin", () => ({
  updateReservationAdmin: vi.fn(),
  deleteReservationAdmin: vi.fn(),
  isAdminConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/line", () => ({
  sendLineFlexMessage: vi.fn(),
  buildPaymentFlex: vi.fn(),
  sendLineMessage: vi.fn(),
  buildReviewInviteMessage: vi.fn(),
}));

vi.mock("@/lib/waitlist", () => ({
  notifyWaitlist: vi.fn(),
}));

vi.mock("@/lib/supabase-fetch", () => ({
  fetchSettings: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  })),
}));

const origPassword = process.env.ADMIN_PASSWORD;
const origSession = process.env.SESSION_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_PASSWORD = "pw";
  process.env.SESSION_SECRET = "sess";
});

afterEach(() => {
  process.env.ADMIN_PASSWORD = origPassword;
  process.env.SESSION_SECRET = origSession;
});

const params = Promise.resolve({ id: "res-1" });

function patchRequest(cookie?: string) {
  return new NextRequest("http://localhost/api/reservations/res-1", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` } : {}),
    },
    body: JSON.stringify({ notes: "updated" }),
  });
}

function deleteRequest(cookie?: string) {
  return new NextRequest("http://localhost/api/reservations/res-1", {
    method: "DELETE",
    headers: cookie ? { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` } : {},
  });
}

describe("PATCH /api/reservations/[id]", () => {
  it("returns 401 without auth cookie", async () => {
    const res = await PATCH(patchRequest(), { params });
    expect(res.status).toBe(401);
    expect(updateReservationAdmin).not.toHaveBeenCalled();
  });

  it("returns 401 with invalid session", async () => {
    const res = await PATCH(patchRequest("bad.token"), { params });
    expect(res.status).toBe(401);
    expect(updateReservationAdmin).not.toHaveBeenCalled();
  });

  it("succeeds with valid admin session", async () => {
    const token = await createSignedAdminSession("sess");
    const res = await PATCH(patchRequest(token), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(updateReservationAdmin).toHaveBeenCalledWith("res-1", { notes: "updated" });
  });
});

describe("DELETE /api/reservations/[id]", () => {
  it("returns 401 without auth cookie", async () => {
    const res = await DELETE(deleteRequest(), { params });
    expect(res.status).toBe(401);
    expect(deleteReservationAdmin).not.toHaveBeenCalled();
  });

  it("returns 401 with invalid session", async () => {
    const res = await DELETE(deleteRequest("invalid"), { params });
    expect(res.status).toBe(401);
    expect(deleteReservationAdmin).not.toHaveBeenCalled();
  });

  it("succeeds with valid admin session", async () => {
    const token = await createSignedAdminSession("sess");
    const res = await DELETE(deleteRequest(token), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(deleteReservationAdmin).toHaveBeenCalledWith("res-1");
  });
});
