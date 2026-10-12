import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  hasHold: vi.fn(),
  transition: vi.fn(),
  claim: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  fetchUnpaidDepositDueReservations: async () => mocks.rows,
  fetchFailedDepositReleaseGroupDeliveries: async () => [],
  updateReservationAdmin: vi.fn(),
  isAdminConfigured: () => true,
  supabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/line", () => ({ sendLineFlexMessage: vi.fn() }));
vi.mock("@/lib/line-cards", () => ({ buildGuestDepositReminderFlex: vi.fn(), buildGuestDepositReleasedFlex: vi.fn() }));
vi.mock("@/lib/line-notify", () => ({
  sendLineFlexBatch: vi.fn(),
  sendLineFlexBatchToGroup: vi.fn(),
  buildDepositReleasedGroupFlex: vi.fn(() => ({})),
}));
vi.mock("@/lib/branch-line-group", () => ({ branchLineGroupIdForReservation: vi.fn(async () => null) }));
vi.mock("@/lib/reservation-lifecycle", () => ({ transitionReservation: mocks.transition }));
vi.mock("@/lib/payment-log", () => ({ logPayment: vi.fn(), logDepositStatusChange: vi.fn() }));
vi.mock("@/lib/cron-alert", () => ({ errorToDetail: String }));
vi.mock("@/lib/job-runs", () => ({ runCronJob: async (_n: string, fn: () => Promise<Response>) => fn() }));
vi.mock("@/lib/cron-request-auth", () => ({ authorizeCronGet: () => ({ ok: true }) }));
vi.mock("@/lib/bootstrap-migrations", () => ({ runBootstrapMigrations: async () => {} }));
vi.mock("@/lib/line-delivery", () => ({
  claimLineReminderDelivery: mocks.claim,
  claimFailedLineReminderDelivery: vi.fn(),
  markLineReminderDelivery: vi.fn(),
  hasDepositReleaseHold: mocks.hasHold,
  safeLineDeliveryError: String,
}));

import { POST } from "./route";

const overdue = {
  id: "r1", booking_code: "ABC", customer_name: "王", phone: "09", status: "pending",
  start_time: new Date(Date.now() - 3_600_000).toISOString(),
  end_time: new Date(Date.now() + 3_600_000).toISOString(),
  created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
  line_user_id: null, deposit_reminder_sent_at: null, room: { id: "room", name: "A" },
};

beforeEach(() => {
  mocks.rows = [overdue];
  mocks.hasHold.mockReset();
  mocks.transition.mockReset().mockResolvedValue({ ok: true });
  mocks.claim.mockReset().mockResolvedValue({ available: true, id: "claim" });
});

describe("deposit-deadline cron after a restore (#437)", () => {
  it("overdue unpaid booking WITHOUT a hold is still released (baseline)", async () => {
    mocks.hasHold.mockResolvedValue(false);
    const body = await (await POST()).json();
    expect(mocks.transition).toHaveBeenCalledWith("r1", { type: "cancel", reason: "deposit_deadline" }, expect.anything());
    expect(body).toMatchObject({ released: 1, held: 0 });
  });

  it("restored (held) booking is NOT cancelled again and nothing is claimed or sent", async () => {
    mocks.hasHold.mockResolvedValue(true);
    const body = await (await POST()).json();
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(body).toMatchObject({ released: 0, held: 1, errors: 0 });
  });

  it("partial claim failure (guest claim ok, group claim throws) does not stick: next run retries and cancels", async () => {
    mocks.hasHold.mockResolvedValue(false); // release-message rows are not a hold
    mocks.rows = [{ ...overdue, line_user_id: "U1" }];
    mocks.claim
      .mockResolvedValueOnce({ available: true, id: "guest-claim" })
      .mockRejectedValueOnce(new Error("group claim failed"));
    const first = await (await POST()).json();
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(first).toMatchObject({ released: 0, errors: 1 });

    mocks.claim.mockReset().mockResolvedValue({ available: true, id: "claim-2" });
    const second = await (await POST()).json();
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ released: 1 });
  });
});
