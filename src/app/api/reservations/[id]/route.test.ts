import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createSignedAdminSession,
} from "@/lib/admin-api-auth";
import {
  updateReservationAdmin,
  deleteReservationAdmin,
  fetchReservationBranchId,
} from "@/lib/supabase-admin";
import { PATCH, DELETE } from "./route";

vi.mock("@/lib/supabase-admin", () => ({
  updateReservationAdmin: vi.fn(),
  deleteReservationAdmin: vi.fn(),
  fetchReservationBranchId: vi.fn(),
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
  vi.mocked(fetchReservationBranchId).mockResolvedValue("b1");
});

afterEach(() => {
  process.env.ADMIN_PASSWORD = origPassword;
  process.env.SESSION_SECRET = origSession;
});

const params = Promise.resolve({ id: "res-1" });

function patchRequest(body: object, cookie?: string) {
  return new NextRequest("http://localhost/api/reservations/res-1", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function deleteRequest(cookie?: string) {
  return new NextRequest("http://localhost/api/reservations/res-1", {
    method: "DELETE",
    headers: cookie ? { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` } : {},
  });
}

async function staffSession() {
  return createSignedAdminSession("sess", 86400, {
    role: "staff",
    branch_ids: ["b1"],
    sub: "staff-1",
  });
}

async function managerSession() {
  return createSignedAdminSession("sess", 86400, {
    role: "branch_manager",
    branch_ids: ["b1"],
    sub: "mgr-1",
  });
}

describe("PATCH /api/reservations/[id]", () => {
  it("returns 401 without auth cookie", async () => {
    const res = await PATCH(patchRequest({ notes: "updated" }), { params });
    expect(res.status).toBe(401);
    expect(updateReservationAdmin).not.toHaveBeenCalled();
  });

  it("returns 403 when staff patches non-status fields", async () => {
    const token = await staffSession();
    const res = await PATCH(patchRequest({ notes: "updated" }, token), { params });
    expect(res.status).toBe(403);
    expect(updateReservationAdmin).not.toHaveBeenCalled();
  });

  it("allows staff to patch status on assigned branch", async () => {
    const token = await staffSession();
    const res = await PATCH(patchRequest({ status: "confirmed" }, token), { params });
    expect(res.status).toBe(200);
    expect(updateReservationAdmin).toHaveBeenCalledWith("res-1", { status: "confirmed" });
  });

  it("allows branch_manager full patch", async () => {
    const token = await managerSession();
    const res = await PATCH(patchRequest({ notes: "updated" }, token), { params });
    expect(res.status).toBe(200);
    expect(updateReservationAdmin).toHaveBeenCalledWith("res-1", { notes: "updated" });
  });
});

describe("DELETE /api/reservations/[id]", () => {
  it("returns 403 for staff without cancel permission", async () => {
    const token = await staffSession();
    const res = await DELETE(deleteRequest(token), { params });
    expect(res.status).toBe(403);
    expect(deleteReservationAdmin).not.toHaveBeenCalled();
  });

  it("allows branch_manager to delete", async () => {
    const token = await managerSession();
    const res = await DELETE(deleteRequest(token), { params });
    expect(res.status).toBe(200);
    expect(deleteReservationAdmin).toHaveBeenCalledWith("res-1");
  });
});
