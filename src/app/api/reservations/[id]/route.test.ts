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
import { transitionReservation } from "@/lib/reservation-lifecycle";
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
  buildReviewInviteFlex: vi.fn(),
  sendLineMessage: vi.fn(),
  buildReviewInviteMessage: vi.fn(),
}));

vi.mock("@/lib/payment-request-line", () => ({
  sendDepositPaymentRequest: vi.fn(async () => ({ result: "sent" })),
}));

vi.mock("@/lib/reservation-lifecycle", async (orig) => ({
  ...(await orig<typeof import("@/lib/reservation-lifecycle")>()),
  loadReservation: vi.fn(async () => ({ status: "pending" })),
  transitionReservation: vi.fn(async () => ({ ok: true, status: "confirmed", lineResult: "sent" })),
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
    expect(transitionReservation).toHaveBeenCalledWith("res-1", { type: "confirm" }, expect.objectContaining({ kind: "admin" }));
    expect(updateReservationAdmin).not.toHaveBeenCalled();
  });

  it("refuses a status the transition table does not allow, writing nothing", async () => {
    const token = await staffSession();
    const res = await PATCH(patchRequest({ status: "reserved" }, token), { params });
    expect(res.status).toBe(409);
    expect(transitionReservation).not.toHaveBeenCalled();
    expect(updateReservationAdmin).not.toHaveBeenCalled();
  });

  it("restore is an explicit intent", async () => {
    const token = await managerSession();
    const res = await PATCH(patchRequest({ intent: "restore" }, token), { params });
    expect(res.status).toBe(200);
    expect(transitionReservation).toHaveBeenCalledWith("res-1", { type: "restore" }, expect.anything());
  });

  it("staff without write permission cannot restore", async () => {
    const token = await staffSession();
    const res = await PATCH(patchRequest({ intent: "restore" }, token), { params });
    expect(res.status).toBe(403);
  });

  it("allows branch_manager full patch", async () => {
    const token = await managerSession();
    const res = await PATCH(patchRequest({ notes: "updated" }, token), { params });
    expect(res.status).toBe(200);
    expect(updateReservationAdmin).toHaveBeenCalledWith("res-1", { notes: "updated" });
  });

  it.each([
    [{ deposit_last_five: "1234a" }, "末五碼須為 5 位數字"],
    [{ deposit_last_five: "123456" }, "末五碼須為 5 位數字"],
    [{ deposit_paid_on: "09/28" }, "匯款日期格式錯誤"],
  ])("rejects malformed deposit transfer info %j", async (body, error) => {
    const token = await managerSession();
    const res = await PATCH(patchRequest(body, token), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(updateReservationAdmin).not.toHaveBeenCalled();
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
