import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authContext: {
    user_id: "staff-1",
    role: "staff" as const,
    branch_ids: ["branch-1"],
    legacy: false,
  },
  fetchContext: vi.fn(async () => ({
    branchId: "branch-1",
    reservation: {} as never,
    branch: {},
  })),
  renderById: vi.fn(async () => ({
    context: { branchId: "branch-1", reservation: {} as never, branch: {} },
    text: "canonical message",
  })),
  recordAction: vi.fn(async () => "action-1"),
}));

vi.mock("@/lib/admin-api-auth", () => ({
  requireAdminApiAuth: vi.fn(async () => null),
  getAdminContext: vi.fn(async () => mocks.authContext),
}));
vi.mock("@/lib/supabase-admin", () => ({ isAdminConfigured: vi.fn(() => true) }));
vi.mock("@/lib/reservation-access", () => ({
  assertReservationMessageSendAllowed: vi.fn(() => null),
}));
vi.mock("@/lib/reservation-message-actions", () => ({
  fetchReservationMessageContext: mocks.fetchContext,
  renderReservationMessageById: mocks.renderById,
  recordReservationMessageAction: mocks.recordAction,
  isValidReservationMessageTemplate: (value: unknown) =>
    ["booking_confirmation", "deposit_request", "deposit_paid", "arrival_reminder"].includes(
      String(value)
    ),
}));

import { POST } from "./route";

const routeContext = { params: Promise.resolve({ id: "reservation-1" }) };

describe("reservation message-actions API", () => {
  it("re-renders canonical text and records a copied action", async () => {
    const request = new NextRequest("http://localhost/api/reservations/reservation-1/message-actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        template_key: "booking_confirmation",
        channel: "manual_line",
        action: "copied",
      }),
    });

    const response = await POST(request, routeContext);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      text: "canonical message",
      action_id: "action-1",
    });
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "reservation-1",
        action: "copied",
        actorUserId: "staff-1",
        renderedText: "canonical message",
      })
    );
  });

  it("rejects illegal actions and channels", async () => {
    const request = (body: unknown) =>
      new NextRequest("http://localhost/api/reservations/reservation-1/message-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const illegalAction = await POST(
      request({ template_key: "booking_confirmation", channel: "manual_line", action: "pushed" }),
      routeContext
    );
    expect(illegalAction.status).toBe(400);

    const illegalChannel = await POST(
      request({ template_key: "booking_confirmation", channel: "official_line", action: "copied" }),
      routeContext
    );
    expect(illegalChannel.status).toBe(400);
  });
});
