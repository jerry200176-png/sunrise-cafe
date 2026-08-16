import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authContext: {
    user_id: "staff-1",
    role: "staff" as const,
    branch_ids: ["branch-1"],
    legacy: false,
  },
  fetchBatch: vi.fn(),
  recordBatch: vi.fn(async (inputs: Array<{ reservationId: string }>) => inputs.map((_, index) => `action-${index + 1}`)),
  assertMessage: vi.fn<() => string | null>(() => null),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requireAdminApiAuth: vi.fn(async () => null),
  getAdminContext: vi.fn(async () => mocks.authContext),
}));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: vi.fn(() => true) }));
vi.mock("@/lib/reservation-access", () => ({
  assertReservationMessageSendAllowed: mocks.assertMessage,
}));
vi.mock("@/lib/reservation-message-actions", () => ({
  fetchReservationMessageBatchContexts: mocks.fetchBatch,
  recordReservationMessageActions: mocks.recordBatch,
}));

import { POST } from "./route";

function context(id: string, overrides: Record<string, unknown> = {}) {
  return {
    reservationId: id,
    branchId: "branch-1",
    phone: "0912345678",
    email: null,
    status: "confirmed",
    reservation: {
      customer_name: "王小明",
      start_time: "2026-08-20T04:00:00.000Z",
      end_time: "2026-08-20T06:00:00.000Z",
      total_price: 2000,
      guest_count: 4,
      booking_code: id.toUpperCase(),
      created_at: "2026-08-13T02:00:00.000Z",
      is_deposit_paid: false,
    },
    branch: { display_name: "昇昇咖啡（大安店）", payment_info: "銀行：測試 123" },
    ...overrides,
  };
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/reservations/message-actions/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("batch reservation message API", () => {
  beforeEach(() => {
    mocks.fetchBatch.mockReset();
    mocks.recordBatch.mockClear();
    mocks.assertMessage.mockClear();
  });

  it("re-queries selected reservations and records every copied member with one batch id", async () => {
    mocks.fetchBatch.mockResolvedValueOnce([context("r-1"), context("r-2")]);
    const preview = await POST(request({ reservation_ids: ["r-1", "r-2"], template_key: "deposit_request", action: "preview" }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.can_batch_copy).toBe(true);
    expect(previewBody.items).toHaveLength(2);
    expect(previewBody.combined_text).toContain("===== 第 1 筆訂位");

    mocks.fetchBatch.mockResolvedValueOnce([context("r-1"), context("r-2")]);
    const copied = await POST(request({
      reservation_ids: ["r-1", "r-2"],
      template_key: "deposit_request",
      action: "copied",
      batch_id: previewBody.batch_id,
    }));
    expect(copied.status).toBe(200);
    expect(mocks.recordBatch).toHaveBeenCalledTimes(1);
    expect(mocks.recordBatch.mock.calls[0][0]).toEqual([
      expect.objectContaining({ reservationId: "r-1", batchId: previewBody.batch_id }),
      expect.objectContaining({ reservationId: "r-2", batchId: previewBody.batch_id }),
    ]);
  });

  it("previews but blocks copy-all for different contacts", async () => {
    mocks.fetchBatch.mockResolvedValueOnce([context("r-1"), context("r-2", { phone: "0987654321" })]);
    const response = await POST(request({ reservation_ids: ["r-1", "r-2"], template_key: "deposit_request", action: "preview" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.can_batch_copy).toBe(false);
    expect(body.warnings.join(" ")).toContain("同一位客人");

    mocks.fetchBatch.mockResolvedValueOnce([context("r-1"), context("r-2", { phone: "0987654321" })]);
    const copied = await POST(request({ reservation_ids: ["r-1", "r-2"], template_key: "deposit_request", action: "copied", batch_id: body.batch_id }));
    expect(copied.status).toBe(409);
    expect(mocks.recordBatch).not.toHaveBeenCalled();
  });

  it("rejects empty and duplicate selections", async () => {
    expect((await POST(request({ reservation_ids: [], template_key: "deposit_request", action: "preview" }))).status).toBe(400);
    expect((await POST(request({ reservation_ids: ["r-1", "r-1"], template_key: "deposit_request", action: "preview" }))).status).toBe(400);
    expect(mocks.fetchBatch).not.toHaveBeenCalled();
  });

  it("rejects cancelled reservations for a batch while allowing server-side single-copy auditing", async () => {
    mocks.fetchBatch.mockResolvedValueOnce([context("r-1"), context("r-2", { status: "cancelled" })]);
    const response = await POST(request({ reservation_ids: ["r-1", "r-2"], template_key: "deposit_request", action: "preview" }));
    expect((await response.json()).can_batch_copy).toBe(false);

    mocks.fetchBatch.mockResolvedValueOnce([context("r-2", { status: "cancelled" })]);
    const single = await POST(request({ reservation_ids: ["r-2"], template_key: "deposit_request", action: "copied" }));
    expect(single.status).toBe(200);
  });

  it("enforces branch message-send authorization for every selected reservation", async () => {
    mocks.fetchBatch.mockResolvedValueOnce([context("r-1"), context("r-2")]);
    mocks.assertMessage.mockReturnValueOnce("Forbidden");
    const response = await POST(request({ reservation_ids: ["r-1", "r-2"], template_key: "deposit_request", action: "preview" }));
    expect(response.status).toBe(403);
    expect(mocks.assertMessage).toHaveBeenCalledWith(mocks.authContext, "branch-1");
  });
});
