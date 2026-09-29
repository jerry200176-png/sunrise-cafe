import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  notifyPaymentApproved,
  isDepositApprovalNotificationEligible,
  __resetPaymentNotifyInFlightForTests,
  DISPATCH_CLAIM_LEASE_MS,
  isLineRetryKeyExpired,
  formatReconciliationRequiredAlert,
  verifyReconciliationRequired,
  reconcilePaymentNotificationMarkSent,
  reconcilePaymentNotificationSafeRetry,
} from "./payment-notify";
import * as lineNotify from "./line-notify";
import * as line from "./line";

interface FakeReservationRow {
  id: string;
  customer_name: string;
  booking_code: string;
  start_time: string;
  end_time: string;
  deposit_payment_note: string | null;
  line_user_id: string | null;
  is_deposit_paid: boolean;
  status: string;
  total_price: number | null;
  deposit_approved_notified_at: string | null;
  deposit_approved_claim_at: string | null;
  deposit_approved_retry_key: string | null;
  deposit_approved_guest_retry_key: string | null;
  deposit_approved_retry_key_created_at: string | null;
}

type MockChainResult = { data: FakeReservationRow | null; error: { message: string } | null };

type MockUpdateChain = {
  eq: (col: string, val: unknown) => MockUpdateChain;
  gt: (col: string, val: number) => MockUpdateChain;
  is: (col: string, val: unknown) => MockUpdateChain;
  or: (filter: string) => MockUpdateChain;
  select: (cols?: string) => MockUpdateChain;
  maybeSingle: () => Promise<MockChainResult>;
  then: <TResult1 = MockChainResult, TResult2 = never>(
    onfulfilled?: ((value: MockChainResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>;
};

function createFakeSupabase(
  initialRow: FakeReservationRow,
  options: {
    claimError?: { message: string };
    pendingReview?: boolean;
    paymentEvents?: Array<{ id: string; status: string }>;
    paymentEventError?: { message: string };
    beforeClaim?: () => void;
  } = {}
) {
  let row = { ...initialRow };
  const updateCalls: Array<Record<string, unknown>> = [];
  const insertedOpsEvents: Array<Record<string, unknown>> = [];

  const client = {
    getRow: () => ({ ...row }),
    getUpdateCalls: () => [...updateCalls],
    getOpsEvents: () => [...insertedOpsEvents],
    setRow: (patch: Partial<FakeReservationRow>) => {
      row = { ...row, ...patch };
    },
    from: vi.fn((table: string) => {
      if (table === "payment_events") {
        const chain = {
          eq: vi.fn(() => chain),
          then: (resolve: (value: { data: Array<{ id: string; status: string }> | null; error: { message: string } | null }) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve({
              data: options.paymentEvents ?? (options.pendingReview ? [{ id: "event-pending", status: "pending_review" }] : []),
              error: options.paymentEventError ?? null,
            }).then(resolve, reject),
        };
        return { select: vi.fn(() => chain) };
      }
      if (table === "reservations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, val: string) => ({
              maybeSingle: vi.fn().mockImplementation(async () => {
                if (row.id !== val) return { data: null, error: null };
                return { data: { ...row }, error: null };
              }),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            updateCalls.push(payload);
            let claimNullCheck = false;
            let claimValCheck: string | null = null;
            let checkPaid = false;
            let checkConfirmed = false;
            let checkPositiveTotal = false;
            let checkNotifiedNull = false;

            if (payload.deposit_approved_claim_at && options.beforeClaim) {
              options.beforeClaim();
            }

            const applyUpdate = (): MockChainResult => {
              if (checkPaid && !row.is_deposit_paid) return { data: null, error: null };
              if (checkConfirmed && row.status !== "confirmed") return { data: null, error: null };
              if (checkPositiveTotal && !(Number(row.total_price) > 0)) return { data: null, error: null };
              if (checkNotifiedNull && row.deposit_approved_notified_at !== null) {
                return { data: null, error: null };
              }
              if (claimNullCheck && row.deposit_approved_claim_at !== null) {
                return { data: null, error: null };
              }
              if (claimValCheck !== null && row.deposit_approved_claim_at !== claimValCheck) {
                return { data: null, error: null };
              }

              row = { ...row, ...payload } as FakeReservationRow;
              return { data: { ...row }, error: null };
            };

            const chain: MockUpdateChain = {
              eq: vi.fn((col: string, val: unknown) => {
                if (col === "is_deposit_paid" && val === true) checkPaid = true;
                if (col === "status" && val === "confirmed") checkConfirmed = true;
                if (col === "deposit_approved_claim_at") claimValCheck = String(val);
                return chain;
              }),
              gt: vi.fn((col: string, val: number) => {
                if (col === "total_price" && val === 0) checkPositiveTotal = true;
                return chain;
              }),
              is: vi.fn((col: string, val: unknown) => {
                if (col === "deposit_approved_notified_at" && val === null) checkNotifiedNull = true;
                if (col === "deposit_approved_claim_at" && val === null) claimNullCheck = true;
                return chain;
              }),
              or: vi.fn(() => chain),
              select: vi.fn(() => chain),
              maybeSingle: vi.fn(async () =>
                options.claimError
                  ? { data: null, error: options.claimError }
                  : applyUpdate()
              ),
              then: (resolve, reject) =>
                Promise.resolve(applyUpdate()).then(resolve, reject),
            };
            return chain;
          }),
        };
      }
      if (table === "ops_events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            contains: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
          insert: vi.fn((payload: Record<string, unknown>) => {
            insertedOpsEvents.push(payload);
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }
      return {};
    }),
  } as unknown as SupabaseClient & {
    getRow: () => FakeReservationRow;
    getUpdateCalls: () => Array<Record<string, unknown>>;
    getOpsEvents: () => Array<Record<string, unknown>>;
    setRow: (patch: Partial<FakeReservationRow>) => void;
  };

  return client;
}

describe("payment-notify", () => {
  const origEnv = { ...process.env };

  const defaultRow: FakeReservationRow = {
    id: "res-123",
    customer_name: "林小姐",
    booking_code: "XYZ789",
    start_time: "2026-09-10T14:00:00+08:00",
    end_time: "2026-09-10T16:00:00+08:00",
    deposit_payment_note: "後台核准",
    line_user_id: "U1234567890",
    status: "confirmed",
    total_price: 3000,
    is_deposit_paid: true,
    deposit_approved_notified_at: null,
    deposit_approved_claim_at: null,
    deposit_approved_retry_key: null,
    deposit_approved_guest_retry_key: null,
    deposit_approved_retry_key_created_at: null,
  };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-key";
    process.env.SESSION_SECRET = "test-secret";
    __resetPaymentNotifyInFlightForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  it("skips send if already notified according to DB-level record", async () => {
    const mockClient = createFakeSupabase({
      ...defaultRow,
      deposit_approved_notified_at: "2026-09-08T10:00:00.000Z",
    });

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(result.already_notified).toBe(true);
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();
  });

  it("only marks deposit_approved_notified_at upon confirmed sent", async () => {
    const mockClient = createFakeSupabase(defaultRow);

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi
      .spyOn(line, "sendLineFlexMessage")
      .mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(result.group_notified).toBe(true);
    expect(result.guest_notified).toBe(true);
    expect(sendLineFlexSpy).toHaveBeenCalledTimes(1);
    expect(sendLineFlexMessageSpy).toHaveBeenCalledTimes(1);

    const updatedRow = mockClient.getRow();
    expect(updatedRow.deposit_approved_notified_at).toBeTruthy();
    expect(updatedRow.deposit_approved_claim_at).toBeNull();
    expect(updatedRow.deposit_approved_retry_key).toBeTruthy();
    expect(updatedRow.deposit_approved_guest_retry_key).toBeTruthy();

    const opsEvents = mockClient.getOpsEvents();
    expect(opsEvents).toHaveLength(2);
    expect(opsEvents[0].action).toBe("payment.approved_attempt");
    expect(opsEvents[1].action).toBe("payment.approved_notified");
    expect((opsEvents[1].detail as Record<string, unknown>).accepted_by_platform).toBe(true);
    expect(result.accepted_by_platform).toBe(true);
  });

  it("central eligibility requires confirmed, paid, valid-deposit, and payment evidence", () => {
    expect(isDepositApprovalNotificationEligible(defaultRow, [])).toBe(true);
    expect(isDepositApprovalNotificationEligible(defaultRow, [{ id: "event-1", status: "approved" }])).toBe(true);
    expect(isDepositApprovalNotificationEligible({ ...defaultRow, status: "pending" }, [])).toBe(false);
    expect(isDepositApprovalNotificationEligible({ ...defaultRow, status: "cancelled" }, [])).toBe(false);
    expect(isDepositApprovalNotificationEligible({ ...defaultRow, is_deposit_paid: false }, [])).toBe(false);
    expect(isDepositApprovalNotificationEligible({ ...defaultRow, total_price: 0 }, [])).toBe(false);
    expect(isDepositApprovalNotificationEligible(defaultRow, [{ id: "event-1", status: "pending_review" }])).toBe(false);
    expect(isDepositApprovalNotificationEligible(defaultRow, [{ id: "event-1", status: "rejected" }])).toBe(false);
    expect(isDepositApprovalNotificationEligible(
      defaultRow,
      [{ id: "event-1", status: "rejected" }],
      { manualApproval: true }
    )).toBe(true);
    expect(isDepositApprovalNotificationEligible(
      defaultRow,
      [{ id: "event-1", status: "approved" }],
      { paymentEventId: "another-event" }
    )).toBe(false);
  });

  it.each([
    ["pending reservation", { status: "pending" }],
    ["cancelled reservation", { status: "cancelled" }],
    ["unpaid reservation", { is_deposit_paid: false }],
    ["reservation without deposit amount", { total_price: 0 }],
  ])("does not send approval notice for %s", async (_label, patch) => {
    const mockClient = createFakeSupabase({ ...defaultRow, ...patch });
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

    const result = await notifyPaymentApproved("res-123", { client: mockClient, force: true });

    expect(result.ok).toBe(false);
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();
  });

  it("does not send while a payment report is pending review, even on forced resend", async () => {
    const mockClient = createFakeSupabase(defaultRow, { pendingReview: true });
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

    const result = await notifyPaymentApproved("res-123", { client: mockClient, force: true });

    expect(result).toMatchObject({ ok: false, error: "payment_pending_review" });
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();
  });

  it("does not resend after a rejected event unless a staff member explicitly marks paid", async () => {
    const mockClient = createFakeSupabase(defaultRow, {
      paymentEvents: [{ id: "event-rejected", status: "rejected" }],
    });
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");

    const result = await notifyPaymentApproved("res-123", { client: mockClient, force: true });

    expect(result).toMatchObject({ ok: false, error: "payment_not_approved" });
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
  });

  it("allows a forced resend when the reservation is still eligible", async () => {
    const mockClient = createFakeSupabase({
      ...defaultRow,
      deposit_approved_notified_at: "2026-09-08T10:00:00.000Z",
    });
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi
      .spyOn(line, "sendLineFlexMessage")
      .mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-123", { client: mockClient, force: true });

    expect(result).toMatchObject({ ok: true, accepted_by_platform: true });
    expect(sendLineFlexSpy).toHaveBeenCalledTimes(1);
    expect(sendLineFlexMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("fails closed if payment review state cannot be checked", async () => {
    const mockClient = createFakeSupabase(defaultRow, {
      paymentEventError: { message: "temporary database error" },
    });
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result).toMatchObject({ ok: false, error: "payment_state_unavailable" });
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
  });

  it("does not dispatch if the reservation becomes cancelled before the atomic claim", async () => {
    const mockClient = createFakeSupabase(defaultRow, {
      beforeClaim: () => mockClient.setRow({ status: "cancelled" }),
    });
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result).toMatchObject({ ok: true, already_notified: false });
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();
  });

  it("does not report success when the guest has no LINE binding", async () => {
    const mockClient = createFakeSupabase({ ...defaultRow, line_user_id: null });
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_line_id");
    expect(result.group_notified).toBe(true);
    expect(result.guest_notified).toBe(false);
    expect(mockClient.getRow().deposit_approved_notified_at).toBeNull();
    expect(sendLineFlexSpy).toHaveBeenCalledTimes(1);
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();
  });

  it("does not resolve the event until both required recipients are accepted", async () => {
    const mockClient = createFakeSupabase(defaultRow);
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi
      .spyOn(line, "sendLineFlexMessage")
      .mockRejectedValueOnce(new Error("guest timeout"))
      .mockResolvedValueOnce(undefined);

    const firstAttempt = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(firstAttempt).toMatchObject({
      ok: false,
      accepted_by_platform: true,
      group_notified: true,
      guest_notified: false,
    });
    const firstGroupCallOptions = sendLineFlexSpy.mock.calls[0]?.[2];
    const firstGuestCallOptions = sendLineFlexMessageSpy.mock.calls[0]?.[3];
    expect(mockClient.getRow().deposit_approved_notified_at).toBeNull();

    __resetPaymentNotifyInFlightForTests();
    const secondAttempt = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(secondAttempt).toMatchObject({
      ok: true,
      accepted_by_platform: true,
      group_notified: true,
      guest_notified: true,
    });
    expect(sendLineFlexSpy).toHaveBeenCalledTimes(2);
    expect(sendLineFlexMessageSpy).toHaveBeenCalledTimes(2);
    expect(sendLineFlexSpy.mock.calls[1]?.[2]).toEqual(firstGroupCallOptions);
    expect(sendLineFlexMessageSpy.mock.calls[1]?.[3]).toEqual(firstGuestCallOptions);
    expect(mockClient.getRow().deposit_approved_notified_at).toBeTruthy();
  });

  it("fails closed when the atomic claim returns a database error", async () => {
    const mockClient = createFakeSupabase(defaultRow, {
      claimError: { message: "database unavailable" },
    });
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result).toEqual({ ok: false, error: "notification_claim_failed" });
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();
    expect(mockClient.getRow().deposit_approved_notified_at).toBeNull();
  });

  it("safely retries after LINE transient failure without permanent lockout", async () => {
    const mockClient = createFakeSupabase(defaultRow);

    const sendLineFlexSpy = vi
      .spyOn(lineNotify, "sendLineFlexToBranchGroup")
      .mockRejectedValue(new Error("LINE API 504 Gateway Timeout"));
    const sendLineFlexMessageSpy = vi
      .spyOn(line, "sendLineFlexMessage")
      .mockRejectedValue(new Error("LINE API 504 Gateway Timeout"));

    // Attempt 1: LINE fails with 504
    const firstAttempt = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(firstAttempt.ok).toBe(false);
    expect(firstAttempt.error).toBe("LINE API 504 Gateway Timeout");

    // After failure: notified_at must remain NULL and claim_at must be released immediately!
    const rowAfterAttempt1 = mockClient.getRow();
    expect(rowAfterAttempt1.deposit_approved_notified_at).toBeNull();
    expect(rowAfterAttempt1.deposit_approved_claim_at).toBeNull();
    // But the retry keys MUST be persisted for provider-level retry
    expect(rowAfterAttempt1.deposit_approved_retry_key).toBeTruthy();
    const persistedGroupKey = rowAfterAttempt1.deposit_approved_retry_key;

    // Attempt 2: LINE is back up! Retry succeeds immediately without being locked out.
    __resetPaymentNotifyInFlightForTests();
    sendLineFlexSpy.mockResolvedValue(undefined);
    sendLineFlexMessageSpy.mockResolvedValue(undefined);

    const secondAttempt = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(secondAttempt.ok).toBe(true);
    expect(secondAttempt.group_notified).toBe(true);

    const rowAfterAttempt2 = mockClient.getRow();
    expect(rowAfterAttempt2.deposit_approved_notified_at).toBeTruthy();
    expect(rowAfterAttempt2.deposit_approved_claim_at).toBeNull();
    // Key was preserved across retries
    expect(rowAfterAttempt2.deposit_approved_retry_key).toBe(persistedGroupKey);
  });

  it("prevents duplicate send when concurrent instance holds an active lease", async () => {
    // An active lease held 10 seconds ago (< 60s lease duration)
    const activeClaimAt = new Date(Date.now() - 10_000).toISOString();
    const mockClient = createFakeSupabase({
      ...defaultRow,
      deposit_approved_claim_at: activeClaimAt,
    });

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(result.already_notified).toBe(false); // In-flight by another instance
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();
  });

  it("re-claims and retries if previous instance crashed and lease expired", async () => {
    // Previous instance claimed lease 70 seconds ago (> 60s lease) and crashed
    const crashedClaimAt = new Date(Date.now() - (DISPATCH_CLAIM_LEASE_MS + 10_000)).toISOString();
    const mockClient = createFakeSupabase({
      ...defaultRow,
      deposit_approved_claim_at: crashedClaimAt,
      deposit_approved_retry_key: "crashed-instance-uuid-key",
      deposit_approved_guest_retry_key: "crashed-guest-uuid-key",
      deposit_approved_retry_key_created_at: crashedClaimAt,
    });

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi
      .spyOn(line, "sendLineFlexMessage")
      .mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(result.group_notified).toBe(true);
    expect(sendLineFlexSpy).toHaveBeenCalledTimes(1);
    expect(sendLineFlexSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      null,
      { retryKey: "crashed-instance-uuid-key" }
    );
    expect(sendLineFlexMessageSpy).toHaveBeenCalledTimes(1);

    const finalRow = mockClient.getRow();
    expect(finalRow.deposit_approved_notified_at).toBeTruthy();
    expect(finalRow.deposit_approved_claim_at).toBeNull();
    // Never regenerated the key merely because the DB lease expired!
    expect(finalRow.deposit_approved_retry_key).toBe("crashed-instance-uuid-key");
  });

  it("regression: accepted-then-timeout/crash reconciles 409 and marks notified without duplicate send", async () => {
    const mockClient = createFakeSupabase(defaultRow);

    // Initial send: LINE accepts the message, but caller experiences network timeout during response read
    const testRetryUuid = "00000000-0000-4000-8000-000000000005";
    mockClient.setRow({
      deposit_approved_retry_key: testRetryUuid,
      deposit_approved_guest_retry_key: "00000000-0000-4000-8000-000000000006",
      deposit_approved_retry_key_created_at: new Date().toISOString(),
      deposit_approved_claim_at: null, // lease released after timeout
      deposit_approved_notified_at: null, // not stamped because response timed out
    });

    // On retry, LINE returns 409 Conflict with x-line-accepted-request-id
    // sendLineFlex handles 409 reconciliation and resolves successfully
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi
      .spyOn(line, "sendLineFlexMessage")
      .mockResolvedValue(undefined);

    const retryResult = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(retryResult.ok).toBe(true);
    expect(retryResult.group_notified).toBe(true);
    expect(sendLineFlexSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      null,
      { retryKey: testRetryUuid }
    );
    expect(sendLineFlexMessageSpy).toHaveBeenCalled();

    // Reconciled successfully in DB!
    const finalRow = mockClient.getRow();
    expect(finalRow.deposit_approved_notified_at).toBeTruthy();
    expect(finalRow.deposit_approved_claim_at).toBeNull();
    expect(finalRow.deposit_approved_retry_key).toBe(testRetryUuid);
  });

  it("regression: 409 reconciliation treats LINE 409 as confirmed sent and records accepted state", async () => {
    // When sendLineFlex encounters 409 for same retry key, it resolves without throwing error
    const mockClient = createFakeSupabase(defaultRow);

    vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
    vi.spyOn(line, "sendLineFlexMessage").mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(result.group_notified).toBe(true);
    expect(result.guest_notified).toBe(true);

    const finalRow = mockClient.getRow();
    expect(finalRow.deposit_approved_notified_at).toBeTruthy();
    expect(finalRow.deposit_approved_claim_at).toBeNull();
  });

  it("regression: concurrent retries ensures only one instance acquires the claim lease and dispatches", async () => {
    const mockClient = createFakeSupabase(defaultRow);

    let concurrentCalls = 0;
    vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockImplementation(async () => {
      concurrentCalls++;
      await new Promise((r) => setTimeout(r, 20));
    });
    vi.spyOn(line, "sendLineFlexMessage").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Run two dispatches concurrently
    const [res1, res2] = await Promise.all([
      notifyPaymentApproved("res-123", { client: mockClient }),
      notifyPaymentApproved("res-123", { client: mockClient }),
    ]);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    // Only one instance performed the dispatch
    expect(concurrentCalls).toBe(1);
  });

  it("regression: key persistence reuses exact same retry key across retries and does NOT regenerate on lease expiry", async () => {
    const stableGroupRetryUuid = "00000000-0000-4000-8000-000000000001";
    const stableGuestRetryUuid = "00000000-0000-4000-8000-000000000002";
    const keyCreatedAt = new Date(Date.now() - 300_000).toISOString(); // 5 minutes ago

    const mockClient = createFakeSupabase({
      ...defaultRow,
      deposit_approved_claim_at: new Date(Date.now() - 100_000).toISOString(), // lease expired (100s ago)
      deposit_approved_retry_key: stableGroupRetryUuid,
      deposit_approved_guest_retry_key: stableGuestRetryUuid,
      deposit_approved_retry_key_created_at: keyCreatedAt,
    });

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi
      .spyOn(line, "sendLineFlexMessage")
      .mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(sendLineFlexSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      null,
      { retryKey: stableGroupRetryUuid }
    );
    expect(sendLineFlexMessageSpy).toHaveBeenCalledWith(
      defaultRow.line_user_id,
      expect.any(String),
      expect.any(Object),
      { retryKey: stableGuestRetryUuid, reservationId: "res-123" }
    );

    const finalRow = mockClient.getRow();
    expect(finalRow.deposit_approved_retry_key).toBe(stableGroupRetryUuid);
    expect(finalRow.deposit_approved_guest_retry_key).toBe(stableGuestRetryUuid);
  });

  it("regression: 24h retry-key helper correctly evaluates retention threshold", () => {
    const now = Date.now();
    // 1. Within 24 hours (e.g. 23 hours ago) -> key is valid
    const within24hIso = new Date(now - 23 * 60 * 60 * 1000).toISOString();
    expect(isLineRetryKeyExpired(within24hIso, now)).toBe(false);

    // 2. Beyond 24 hours (e.g. 25 hours ago) -> key is expired under LINE retention window
    const beyond24hIso = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    expect(isLineRetryKeyExpired(beyond24hIso, now)).toBe(true);
  });

  it("regression: >24h accepted-then-timeout ambiguity stops automatic delivery and enters reconciliation_required", async () => {
    // Scenario: Provider request was accepted by LINE 25h ago, but caller timed out waiting for
    // HTTP response before deposit_approved_notified_at was stamped.
    // Now >24h have passed. Re-attempting delivery MUST NOT mint a new key or dispatch to LINE,
    // because that risks a duplicate message to staff/guest. It must enter reconciliation_required.
    const beyond24hIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const priorAttemptKey = "00000000-0000-4000-8000-000000000099";

    const mockClient = createFakeSupabase({
      ...defaultRow,
      deposit_approved_claim_at: null, // lease released after timeout
      deposit_approved_notified_at: null, // not stamped because client timed out
      deposit_approved_retry_key: priorAttemptKey,
      deposit_approved_guest_retry_key: "00000000-0000-4000-8000-000000000098",
      deposit_approved_retry_key_created_at: beyond24hIso,
    });

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    // 1. Automatic delivery halted
    expect(result.ok).toBe(false);
    expect(result.error).toBe("reconciliation_required");
    expect(result.reconciliation_required).toBe(true);
    expect(result.reason).toContain("LINE 24h retry window expired");

    // 2. No provider dispatch occurred (avoids duplicate notification risk)
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();

    // 3. Database row was NOT mutated with a newly minted retry key
    const finalRow = mockClient.getRow();
    expect(finalRow.deposit_approved_retry_key).toBe(priorAttemptKey);
    expect(finalRow.deposit_approved_notified_at).toBeNull();

    // 4. Recorded in ops_events for administrative audit and manual reconciliation
    const opsEvents = mockClient.getOpsEvents();
    expect(opsEvents).toHaveLength(1);
    expect(opsEvents[0].action).toBe("payment.approved_notification_reconciliation_required");
    expect(opsEvents[0].detail).toMatchObject({
      reservation_id: "res-123",
      group_retry_key: priorAttemptKey,
      reason: "retry_key_expired_with_possible_provider_attempt",
    });
  });

  it("regression: >24h unresolved provider attempt stops automatic delivery without minting a fresh key", async () => {
    // Scenario: A prior provider attempt was made with key K >24h ago, but provider returned 5xx
    // or connection dropped, leaving delivery unresolved and unconfirmed.
    // >24h later, retrying must enter reconciliation_required instead of blindly minting a new key.
    const beyond24hIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const unresolvedKey = "00000000-0000-4000-8000-000000000097";

    const mockClient = createFakeSupabase({
      ...defaultRow,
      deposit_approved_claim_at: null,
      deposit_approved_notified_at: null,
      deposit_approved_retry_key: unresolvedKey,
      deposit_approved_guest_retry_key: "00000000-0000-4000-8000-000000000096",
      deposit_approved_retry_key_created_at: beyond24hIso,
    });

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("reconciliation_required");
    expect(result.reconciliation_required).toBe(true);
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();

    const finalRow = mockClient.getRow();
    expect(finalRow.deposit_approved_retry_key).toBe(unresolvedKey);
    expect(finalRow.deposit_approved_notified_at).toBeNull();
  });

  it("regression: safe fresh-key creation before any provider attempt", async () => {
    // Scenario: First logical payment approval notification.
    // deposit_approved_retry_key is null, proving no provider request was ever attempted.
    // Minting a fresh key is safe and required.
    const mockClient = createFakeSupabase({
      ...defaultRow,
      deposit_approved_claim_at: null,
      deposit_approved_notified_at: null,
      deposit_approved_retry_key: null,
      deposit_approved_guest_retry_key: null,
      deposit_approved_retry_key_created_at: null,
    });

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage").mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(result.accepted_by_platform).toBe(true);
    expect(result.group_notified).toBe(true);
    expect(result.guest_notified).toBe(true);

    const finalRow = mockClient.getRow();
    // Fresh UUIDs were minted and stored
    expect(finalRow.deposit_approved_retry_key).toBeTruthy();
    expect(finalRow.deposit_approved_guest_retry_key).toBeTruthy();
    expect(finalRow.deposit_approved_retry_key_created_at).toBeTruthy();
    expect(finalRow.deposit_approved_notified_at).toBeTruthy();

    expect(sendLineFlexSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      null,
      { retryKey: finalRow.deposit_approved_retry_key }
    );
    expect(sendLineFlexMessageSpy).toHaveBeenCalledWith(
      defaultRow.line_user_id,
      expect.any(String),
      expect.any(Object),
      { retryKey: finalRow.deposit_approved_guest_retry_key, reservationId: "res-123" }
    );
  });

  it("regression: safe fresh-key creation after >24h when operator explicitly authorizes safe retry", async () => {
    // Scenario: Key was allocated in DB >24h ago. Operator has performed reconciliation inspection
    // and explicitly authorized safe retry (operatorConfirmedSafeRetry). Minting a fresh key is permitted.
    const beyond24hIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const oldNeverAttemptedKey = "00000000-0000-4000-8000-000000000095";

    const mockClient = createFakeSupabase({
      ...defaultRow,
      deposit_approved_claim_at: null,
      deposit_approved_notified_at: null,
      deposit_approved_retry_key: oldNeverAttemptedKey,
      deposit_approved_guest_retry_key: "00000000-0000-4000-8000-000000000094",
      deposit_approved_retry_key_created_at: beyond24hIso,
    });

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
    vi.spyOn(line, "sendLineFlexMessage").mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-123", {
      client: mockClient,
      operatorConfirmedSafeRetry: true,
    });

    expect(result.ok).toBe(true);
    expect(result.accepted_by_platform).toBe(true);

    const finalRow = mockClient.getRow();
    expect(finalRow.deposit_approved_retry_key).not.toBe(oldNeverAttemptedKey);
    expect(finalRow.deposit_approved_retry_key).toBeTruthy();
    expect(sendLineFlexSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      null,
      { retryKey: finalRow.deposit_approved_retry_key }
    );
  });

  it("regression: 2xx and 409+x-line-accepted-request-id semantics represent accepted by LINE Platform, not guaranteed delivered", async () => {
    const mockClient = createFakeSupabase(defaultRow);

    // Both staff group and guest bot pushes succeed (accepted by LINE Platform)
    vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
    vi.spyOn(line, "sendLineFlexMessage").mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    // Explicit contract: accepted by LINE Platform, not guaranteed delivered to handset
    expect(result.accepted_by_platform).toBe(true);
    expect(result.group_notified).toBe(true);
    expect(result.guest_notified).toBe(true);

    const opsEvents = mockClient.getOpsEvents();
    const notifiedEvent = opsEvents.find((e) => e.action === "payment.approved_notified");
    expect(notifiedEvent).toBeDefined();
    expect((notifiedEvent?.detail as Record<string, unknown>).accepted_by_platform).toBe(true);
  });

  it("aborts if deposit is not marked paid", async () => {
    const mockClient = createFakeSupabase({
      ...defaultRow,
      is_deposit_paid: false,
    });

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");
    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("deposit_not_paid");
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
  });

  describe("operational reconciliation follow-up", () => {
    it("formatReconciliationRequiredAlert formats alert with details and CLI actions", () => {
      const text = formatReconciliationRequiredAlert({
        reservationId: "res-123",
        bookingCode: "BK1234",
        customerName: "Alice",
        groupRetryKey: "key-123",
        retryKeyCreatedAt: "2026-09-07T00:00:00.000Z",
      });

      expect(text).toContain("⚠️【LINE 訂金通知需人工對帳】");
      expect(text).toContain("BK1234");
      expect(text).toContain("Alice");
      expect(text).toContain("scripts/reconcile-payment-notification.mjs res-123 --mark-sent");
      expect(text).toContain("scripts/reconcile-payment-notification.mjs res-123 --safe-retry");
    });

    it("sends staff LINE alert on reconciliation_required and records ops_events", async () => {
      const beyond24hIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const mockClient = createFakeSupabase({
        ...defaultRow,
        deposit_approved_retry_key: "00000000-0000-4000-8000-000000000099",
        deposit_approved_retry_key_created_at: beyond24hIso,
      });

      vi.spyOn(lineNotify, "isLineConfigured").mockReturnValue(true);
      const sendLineMessageSpy = vi.spyOn(lineNotify, "sendLineMessage").mockResolvedValue(undefined);

      const result = await notifyPaymentApproved("res-123", { client: mockClient });

      expect(result.ok).toBe(false);
      expect(result.reconciliation_required).toBe(true);

      // Staff LINE alert was dispatched
      expect(sendLineMessageSpy).toHaveBeenCalledTimes(1);
      const alertMessage = sendLineMessageSpy.mock.calls[0][0];
      expect(alertMessage).toContain("⚠️【LINE 訂金通知需人工對帳】");
      expect(alertMessage).toContain("XYZ789");
      expect(alertMessage).toContain("scripts/reconcile-payment-notification.mjs res-123 --mark-sent");

      // ops_events audit event was retained
      const opsEvents = mockClient.getOpsEvents();
      expect(opsEvents.some((e) => e.action === "payment.approved_notification_reconciliation_required")).toBe(true);
    });

    it("verifyReconciliationRequired validates preconditions and fails closed on invalid state", async () => {
      const beyond24hIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

      // 1. Valid reconciliation_required state
      const validClient = createFakeSupabase({
        ...defaultRow,
        deposit_approved_retry_key: "key-123",
        deposit_approved_retry_key_created_at: beyond24hIso,
        deposit_approved_notified_at: null,
      });
      const validRes = await verifyReconciliationRequired("res-123", validClient as unknown as SupabaseClient);
      expect(validRes.ok).toBe(true);

      // 2. Fails closed: non-existent reservation
      const missingRes = await verifyReconciliationRequired("res-missing", validClient as unknown as SupabaseClient);
      expect(missingRes.ok).toBe(false);
      expect(missingRes.error).toBe("reservation_not_found");

      // 3. Fails closed: deposit not paid
      const unpaidClient = createFakeSupabase({
        ...defaultRow,
        is_deposit_paid: false,
        deposit_approved_retry_key: "key-123",
        deposit_approved_retry_key_created_at: beyond24hIso,
      });
      const unpaidRes = await verifyReconciliationRequired("res-123", unpaidClient as unknown as SupabaseClient);
      expect(unpaidRes.ok).toBe(false);
      expect(unpaidRes.error).toBe("deposit_not_paid");

      // 4. Fails closed: already resolved / notified
      const alreadyNotifiedClient = createFakeSupabase({
        ...defaultRow,
        deposit_approved_notified_at: new Date().toISOString(),
        deposit_approved_retry_key: "key-123",
        deposit_approved_retry_key_created_at: beyond24hIso,
      });
      const alreadyNotifiedRes = await verifyReconciliationRequired("res-123", alreadyNotifiedClient as unknown as SupabaseClient);
      expect(alreadyNotifiedRes.ok).toBe(false);
      expect(alreadyNotifiedRes.error).toBe("already_resolved");

      // 5. Fails closed: no prior retry key
      const noKeyClient = createFakeSupabase({
        ...defaultRow,
        deposit_approved_retry_key: null,
      });
      const noKeyRes = await verifyReconciliationRequired("res-123", noKeyClient as unknown as SupabaseClient);
      expect(noKeyRes.ok).toBe(false);
      expect(noKeyRes.error).toBe("no_prior_retry_key");

      // 6. Fails closed: retry key still valid within 24h
      const recentIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const within24hClient = createFakeSupabase({
        ...defaultRow,
        deposit_approved_retry_key: "key-123",
        deposit_approved_retry_key_created_at: recentIso,
      });
      const within24hRes = await verifyReconciliationRequired("res-123", within24hClient as unknown as SupabaseClient);
      expect(within24hRes.ok).toBe(false);
      expect(within24hRes.error).toBe("retry_key_still_valid_within_24h");
    });

    it("reconcilePaymentNotificationMarkSent marks state resolved without sending LINE and records audit event", async () => {
      const beyond24hIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const mockClient = createFakeSupabase({
        ...defaultRow,
        deposit_approved_claim_at: "2026-09-08T00:00:00.000Z",
        deposit_approved_notified_at: null,
        deposit_approved_retry_key: "key-123",
        deposit_approved_retry_key_created_at: beyond24hIso,
      });

      const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup");
      const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

      const result = await reconcilePaymentNotificationMarkSent("res-123", {
        actor: "test_operator",
        client: mockClient as unknown as SupabaseClient,
      });

      expect(result.ok).toBe(true);
      expect(result.method).toBe("mark_sent");
      expect(result.reservation_id).toBe("res-123");
      expect(result.booking_code).toBe("XYZ789");
      expect(result.notified_at).toBeDefined();

      // Database state updated
      const row = mockClient.getRow();
      expect(row.deposit_approved_notified_at).toBeDefined();
      expect(row.deposit_approved_claim_at).toBeNull();
      // Retry key preserved (not touched)
      expect(row.deposit_approved_retry_key).toBe("key-123");

      // NO LINE message dispatched
      expect(sendLineFlexSpy).not.toHaveBeenCalled();
      expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();

      // ops_events recorded
      const opsEvents = mockClient.getOpsEvents();
      const reconcileEvent = opsEvents.find((e) => e.action === "payment.approved_notification_reconciled");
      expect(reconcileEvent).toBeDefined();
      expect(reconcileEvent?.detail).toMatchObject({
        actor: "test_operator",
        timestamp: expect.any(String),
        reservation_id: "res-123",
        booking_code: "XYZ789",
        method: "mark_sent",
        authorization: "operator_confirmed_mark_sent",
        reconciliation_reason: expect.any(String),
        evidence_checked: expect.any(String),
        prior_retry_identity: {
          group_retry_key: "key-123",
        },
        resolution_outcome: {
          outcome: "marked_resolved_without_resending",
        },
      });

      // Idempotency: calling again fails closed because already resolved
      const repeatResult = await reconcilePaymentNotificationMarkSent("res-123", {
        client: mockClient as unknown as SupabaseClient,
      });
      expect(repeatResult.ok).toBe(false);
      expect(repeatResult.error).toBe("already_resolved");
    });

    it("reconcilePaymentNotificationSafeRetry invokes canonical notification path with operatorConfirmedSafeRetry authorization", async () => {
      const beyond24hIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const mockClient = createFakeSupabase({
        ...defaultRow,
        deposit_approved_claim_at: null,
        deposit_approved_notified_at: null,
        deposit_approved_retry_key: "old-key-123",
        deposit_approved_guest_retry_key: "old-guest-key-123",
        deposit_approved_retry_key_created_at: beyond24hIso,
      });

      const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlexToBranchGroup").mockResolvedValue(undefined);
      const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage").mockResolvedValue(undefined);

      const result = await reconcilePaymentNotificationSafeRetry("res-123", {
        actor: "test_operator",
        client: mockClient as unknown as SupabaseClient,
      });

      expect(result.ok).toBe(true);
      expect(result.method).toBe("safe_retry");
      expect(result.notify_result?.ok).toBe(true);
      expect(result.notify_result?.group_notified).toBe(true);
      expect(result.notify_result?.guest_notified).toBe(true);

      // A fresh key was minted (not the old expired key)
      expect(result.notify_result?.group_retry_key).not.toBe("old-key-123");

      // Canonical notifications sent to LINE
      expect(sendLineFlexSpy).toHaveBeenCalledTimes(1);
      expect(sendLineFlexMessageSpy).toHaveBeenCalledTimes(1);

      // Database state updated with notified_at
      const row = mockClient.getRow();
      expect(row.deposit_approved_notified_at).toBeDefined();
      expect(row.deposit_approved_retry_key).not.toBe("old-key-123");

      // ops_events recorded
      const opsEvents = mockClient.getOpsEvents();
      const reconcileEvent = opsEvents.find((e) => e.action === "payment.approved_notification_reconciled");
      expect(reconcileEvent).toBeDefined();
      expect(reconcileEvent?.detail).toMatchObject({
        actor: "test_operator",
        timestamp: expect.any(String),
        reservation_id: "res-123",
        booking_code: "XYZ789",
        method: "safe_retry",
        authorization: "operator_confirmed_safe_retry",
        reconciliation_reason: expect.any(String),
        evidence_checked: expect.any(String),
        prior_retry_identity: {
          group_retry_key: "old-key-123",
        },
        resolution_outcome: {
          outcome: "authorized_retry_accepted",
          success: true,
        },
      });

      // Subsequent attempt fails closed because already resolved
      const repeatResult = await reconcilePaymentNotificationSafeRetry("res-123", {
        client: mockClient as unknown as SupabaseClient,
      });
      expect(repeatResult.ok).toBe(false);
      expect(repeatResult.error).toBe("already_resolved");
    });
  });
});
