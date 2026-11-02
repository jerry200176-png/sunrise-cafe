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

describe("versioned copy verification", () => {
  it("rechecks rendered branch authorization before recording", async () => {
    const { createHash } = await import("node:crypto");
    const { POST: postV2 } = await import("./v2/route");
    mocks.recordAction.mockClear(); mocks.assertMessage.mockReset();
    mocks.assertMessage.mockReturnValueOnce(null).mockReturnValueOnce("Forbidden");
    const req = new NextRequest("http://localhost/v2", { method: "POST", body: JSON.stringify({ version: 2, template_key: "booking_confirmation", channel: "manual_line", action: "copied", digest: createHash("sha256").update("canonical message").digest("hex") }) });
    expect((await postV2(req, routeContext)).status).toBe(403);
    expect(mocks.recordAction).not.toHaveBeenCalled();
    mocks.assertMessage.mockReset().mockReturnValue(null);
  });
  it("rejects a changed digest before recording and accepts the matching text", async () => {
    const { createHash } = await import("node:crypto");
    const { POST: postV2 } = await import("./v2/route");
    const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
    const request = (value: unknown) => new NextRequest("http://localhost/v2", { method: "POST", body: JSON.stringify({ version: 2, template_key: "booking_confirmation", channel: "manual_line", action: "copied", digest: value }) });
    mocks.recordAction.mockClear();
    expect((await postV2(request(digest("outdated")), routeContext)).status).toBe(409);
    expect(mocks.recordAction).not.toHaveBeenCalled();
    expect((await postV2(request({ digest: "bad" }), routeContext)).status).toBe(400);
    expect(mocks.recordAction).not.toHaveBeenCalled();
    const response = await postV2(request(digest("canonical message")), routeContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: 2, action_id: "action-1" });
    expect(mocks.recordAction).toHaveBeenCalledOnce();
  });
});
