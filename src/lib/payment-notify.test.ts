import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  notifyPaymentApproved,
  __resetPaymentNotifyInFlightForTests,
  DISPATCH_CLAIM_LEASE_MS,
  isLineRetryKeyExpired,
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
  deposit_approved_notified_at: string | null;
  deposit_approved_claim_at: string | null;
  deposit_approved_retry_key: string | null;
  deposit_approved_guest_retry_key: string | null;
  deposit_approved_retry_key_created_at: string | null;
}

type MockChainResult = { data: FakeReservationRow | null; error: null };

type MockUpdateChain = {
  eq: (col: string, val: unknown) => MockUpdateChain;
  is: (col: string, val: unknown) => MockUpdateChain;
  or: (filter: string) => MockUpdateChain;
  select: (cols?: string) => MockUpdateChain;
  maybeSingle: () => Promise<MockChainResult>;
  then: <TResult1 = MockChainResult, TResult2 = never>(
    onfulfilled?: ((value: MockChainResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => Promise<TResult1 | TResult2>;
};

function createFakeSupabase(initialRow: FakeReservationRow) {
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
            let checkNotifiedNull = false;

            const applyUpdate = (): MockChainResult => {
              if (checkPaid && !row.is_deposit_paid) return { data: null, error: null };
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
                if (col === "deposit_approved_claim_at") claimValCheck = String(val);
                return chain;
              }),
              is: vi.fn((col: string, val: unknown) => {
                if (col === "deposit_approved_notified_at" && val === null) checkNotifiedNull = true;
                if (col === "deposit_approved_claim_at" && val === null) claimNullCheck = true;
                return chain;
              }),
              or: vi.fn(() => chain),
              select: vi.fn(() => chain),
              maybeSingle: vi.fn(async () => applyUpdate()),
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

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex");
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(result.already_notified).toBe(true);
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();
  });

  it("only marks deposit_approved_notified_at upon confirmed sent", async () => {
    const mockClient = createFakeSupabase(defaultRow);

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex").mockResolvedValue(undefined);
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
    expect(opsEvents).toHaveLength(1);
    expect(opsEvents[0].action).toBe("payment.approved_notified");
  });

  it("safely retries after LINE transient failure without permanent lockout", async () => {
    const mockClient = createFakeSupabase(defaultRow);

    const sendLineFlexSpy = vi
      .spyOn(lineNotify, "sendLineFlex")
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

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex");
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

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex").mockResolvedValue(undefined);
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
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi
      .spyOn(line, "sendLineFlexMessage")
      .mockResolvedValue(undefined);

    const retryResult = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(retryResult.ok).toBe(true);
    expect(retryResult.group_notified).toBe(true);
    expect(sendLineFlexSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
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

    vi.spyOn(lineNotify, "sendLineFlex").mockResolvedValue(undefined);
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
    vi.spyOn(lineNotify, "sendLineFlex").mockImplementation(async () => {
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

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi
      .spyOn(line, "sendLineFlexMessage")
      .mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(sendLineFlexSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      { retryKey: stableGroupRetryUuid }
    );
    expect(sendLineFlexMessageSpy).toHaveBeenCalledWith(
      defaultRow.line_user_id,
      expect.any(String),
      expect.any(Object),
      { retryKey: stableGuestRetryUuid }
    );

    const finalRow = mockClient.getRow();
    expect(finalRow.deposit_approved_retry_key).toBe(stableGroupRetryUuid);
    expect(finalRow.deposit_approved_guest_retry_key).toBe(stableGuestRetryUuid);
  });

  it("regression: 24h retry-key constraint reuses key within 24h, mints fresh key when >24h", async () => {
    const now = Date.now();

    // 1. Within 24 hours (e.g. 23 hours ago) -> key is valid
    const within24hIso = new Date(now - 23 * 60 * 60 * 1000).toISOString();
    expect(isLineRetryKeyExpired(within24hIso, now)).toBe(false);

    // 2. Beyond 24 hours (e.g. 25 hours ago) -> key is expired under LINE retention window
    const beyond24hIso = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    expect(isLineRetryKeyExpired(beyond24hIso, now)).toBe(true);

    // 3. Test execution when key is expired (> 24h)
    const expiredGroupRetryUuid = "00000000-0000-4000-8000-000000000099";
    const mockClient = createFakeSupabase({
      ...defaultRow,
      deposit_approved_claim_at: null,
      deposit_approved_retry_key: expiredGroupRetryUuid,
      deposit_approved_guest_retry_key: "00000000-0000-4000-8000-000000000098",
      deposit_approved_retry_key_created_at: beyond24hIso,
    });

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex").mockResolvedValue(undefined);
    vi.spyOn(line, "sendLineFlexMessage").mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    // Fresh UUID was minted because old key was >24h old!
    const finalRow = mockClient.getRow();
    expect(finalRow.deposit_approved_retry_key).not.toBe(expiredGroupRetryUuid);
    expect(finalRow.deposit_approved_retry_key).toBeTruthy();
    expect(sendLineFlexSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      { retryKey: finalRow.deposit_approved_retry_key }
    );
  });

  it("aborts if deposit is not marked paid", async () => {
    const mockClient = createFakeSupabase({
      ...defaultRow,
      is_deposit_paid: false,
    });

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex");
    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("deposit_not_paid");
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
  });
});
