import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getAdminContext: vi.fn(),
  isAdminConfigured: vi.fn(),
  approvePaymentEvent: vi.fn(),
  logOps: vi.fn(),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requirePermission: mocks.requirePermission,
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: mocks.isAdminConfigured,
}));
vi.mock("@/lib/payment-events-admin", () => ({
  approvePaymentEvent: mocks.approvePaymentEvent,
}));
vi.mock("@/lib/payment-notify", () => ({
  paymentNotificationStatus: (result: { ok: boolean; already_notified?: boolean; accepted_by_platform?: boolean; error?: string }) =>
    result.ok && result.already_notified
      ? "already_notified"
      : result.ok && result.accepted_by_platform
        ? "accepted_by_platform"
        : result.error === "no_line_id"
          ? "not_bound"
          : result.error === "admin_unconfigured"
            ? "not_configured"
            : "failed",
}));
vi.mock("@/lib/ops-log", () => ({ logOps: mocks.logOps }));
import { POST } from "./route";

function request() {
  return new NextRequest("http://localhost/api/admin/payments/payment-1/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

describe("POST /api/admin/payments/[id]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(null);
    mocks.getAdminContext.mockResolvedValue({ user_id: "admin-1", email: null });
    mocks.isAdminConfigured.mockReturnValue(true);
    mocks.approvePaymentEvent.mockResolvedValue({ already_processed: false, notification: null });
  });

  it("reports provider acceptance after payment approval", async () => {
    mocks.approvePaymentEvent.mockResolvedValue({
      already_processed: false,
      notification: { ok: true, accepted_by_platform: true },
    });

    const response = await POST(request(), { params: Promise.resolve({ id: "payment-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.approvePaymentEvent).toHaveBeenCalledWith("payment-1", null, "admin-1");
    expect(body).toMatchObject({
      ok: true,
      notification: { ok: true, status: "accepted_by_platform" },
    });
  });

  it("does not redispatch a notification for an already processed payment event", async () => {
    mocks.approvePaymentEvent.mockResolvedValue({ already_processed: true });

    const response = await POST(request(), { params: Promise.resolve({ id: "payment-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, already_processed: true, notification: null });
  });

  it("keeps the committed payment approval but reports LINE failure", async () => {
    mocks.approvePaymentEvent.mockResolvedValue({
      already_processed: false,
      notification: { ok: false, error: "LINE API 401" },
    });

    const response = await POST(request(), { params: Promise.resolve({ id: "payment-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.approvePaymentEvent).toHaveBeenCalledWith("payment-1", null, "admin-1");
    expect(body).toMatchObject({
      ok: true,
      notification: { ok: false, status: "failed", error: "LINE API 401" },
    });
  });

  it("does not false-report success when the notification helper throws", async () => {
    mocks.approvePaymentEvent.mockResolvedValue({
      already_processed: false,
      notification: { ok: false, error: "notification_dispatch_failed" },
    });

    const response = await POST(request(), { params: Promise.resolve({ id: "payment-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      notification: { ok: false, status: "failed", error: "notification_dispatch_failed" },
    });
  });
});
