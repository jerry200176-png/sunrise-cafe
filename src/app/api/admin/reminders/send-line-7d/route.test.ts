import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  fetchReservationsIn7Days: vi.fn(async () => [{ id: "synthetic", start_time: "2026-09-12T10:00:00Z", line_user_id: "synthetic" }]),
  updateReservationAdmin: vi.fn(), isAdminConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/line", () => ({ sendLineFlexMessage: vi.fn() }));
vi.mock("@/lib/bootstrap-migrations", () => ({ runBootstrapMigrations: vi.fn(async () => {}) }));
vi.mock("@/lib/cron-request-auth", () => ({ authorizeCronGet: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/job-runs", () => ({ runCronJob: vi.fn(async (_name: string, handler: () => Promise<Response>) => handler()) }));
vi.mock("@/lib/line-delivery", () => ({
  claimLineReminderDelivery: vi.fn(async () => ({ available: false, id: null })),
  markLineReminderDelivery: vi.fn(), safeLineDeliveryError: vi.fn((e: unknown) => String(e)),
}));

import { POST } from "./route";
import { sendLineFlexMessage } from "@/lib/line";
import { updateReservationAdmin } from "@/lib/supabase-admin";

describe("7-day reminder ledger failure", () => {
  it("does not send or mark a reminder without a claim", async () => {
    const response = await POST();
    expect(response.status).toBe(500);
    expect(sendLineFlexMessage).not.toHaveBeenCalled();
    expect(updateReservationAdmin).not.toHaveBeenCalled();
  });
});
