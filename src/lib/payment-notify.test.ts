import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  notifyPaymentApproved,
  __resetPaymentNotifyInFlightForTests,
  DISPATCH_CLAIM_LEASE_MS,
} from "./payment-notify";
import * as lineNotify from "./line-notify";
import * as line from "./line";

describe("payment-notify", () => {
  const origEnv = { ...process.env };

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
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "reservations") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              or: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: null, // Claim returns null (deposit_approved_notified_at is not null)
                error: null,
              }),
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "res-123",
                  is_deposit_paid: true,
                  deposit_approved_notified_at: "2026-09-08T10:00:00.000Z",
                  deposit_approved_claim_at: null,
                },
                error: null,
              }),
            }),
          };
        }
        if (table === "ops_events") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex");
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(result.already_notified).toBe(true);
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();
  });

  it("only marks deposit_approved_notified_at upon confirmed sent", async () => {
    const updatesApplied: Array<Record<string, unknown>> = [];

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "reservations") {
          return {
            update: vi.fn((payload: Record<string, unknown>) => {
              updatesApplied.push(payload);
              return {
                eq: vi.fn().mockReturnThis(),
                is: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "res-123",
                    customer_name: "林小姐",
                    booking_code: "XYZ789",
                    start_time: "2026-09-10T14:00:00+08:00",
                    end_time: "2026-09-10T16:00:00+08:00",
                    deposit_payment_note: "後台核准",
                    line_user_id: "U1234567890",
                    is_deposit_paid: true,
                    deposit_approved_notified_at: null,
                    deposit_approved_claim_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              };
            }),
          };
        }
        if (table === "ops_events") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    vi.spyOn(lineNotify, "sendLineFlex").mockResolvedValue(undefined);
    vi.spyOn(line, "sendLineFlexMessage").mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-123", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(result.group_notified).toBe(true);
    expect(result.guest_notified).toBe(true);

    // Verify update progression:
    // First update was claim lease ONLY (deposit_approved_notified_at was NOT set!)
    expect(updatesApplied[0]).toHaveProperty("deposit_approved_claim_at");
    expect(updatesApplied[0]).not.toHaveProperty("deposit_approved_notified_at");

    // Second update occurred AFTER send confirmed: stamped deposit_approved_notified_at
    expect(updatesApplied[1]).toHaveProperty("deposit_approved_notified_at");
    expect(updatesApplied[1]).toHaveProperty("deposit_approved_claim_at", null);
  });

  it("safely retries after LINE transient failure without permanent lockout", async () => {
    // Stateful mock reservation row simulating DB table state
    const dbRow = {
      id: "res-retry-1",
      customer_name: "陳先生",
      booking_code: "RET123",
      start_time: "2026-09-10T14:00:00+08:00",
      end_time: "2026-09-10T16:00:00+08:00",
      deposit_payment_note: null,
      line_user_id: null,
      is_deposit_paid: true,
      deposit_approved_notified_at: null as string | null,
      deposit_approved_claim_at: null as string | null,
    };

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "reservations") {
          return {
            update: vi.fn((patch: Record<string, unknown>) => {
              Object.assign(dbRow, patch);
              return {
                eq: vi.fn().mockReturnThis(),
                is: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockImplementation(async () => {
                  return { data: { ...dbRow }, error: null };
                }),
              };
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockImplementation(async () => {
                return { data: { ...dbRow }, error: null };
              }),
            }),
          };
        }
        if (table === "ops_events") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    // First attempt: LINE API throws network timeout error
    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex").mockRejectedValueOnce(
      new Error("LINE API 504 Gateway Timeout")
    );

    const firstAttempt = await notifyPaymentApproved("res-retry-1", { client: mockClient });

    // Assert: First attempt failed
    expect(firstAttempt.ok).toBe(false);
    expect(firstAttempt.error).toContain("504 Gateway Timeout");

    // CRITICAL: deposit_approved_notified_at MUST NOT have been stamped!
    expect(dbRow.deposit_approved_notified_at).toBeNull();
    // Claim lease must have been cleared so retry is immediately possible
    expect(dbRow.deposit_approved_claim_at).toBeNull();

    // Reset in-memory test guard to simulate a subsequent request / new instance
    __resetPaymentNotifyInFlightForTests();

    // Second attempt (retry): LINE API recovers and succeeds
    sendLineFlexSpy.mockResolvedValueOnce(undefined);

    const secondAttempt = await notifyPaymentApproved("res-retry-1", { client: mockClient });

    // Assert: Second attempt succeeds
    expect(secondAttempt.ok).toBe(true);
    expect(secondAttempt.group_notified).toBe(true);

    // CRITICAL: Now and ONLY now is deposit_approved_notified_at stamped!
    expect(dbRow.deposit_approved_notified_at).not.toBeNull();
  });

  it("prevents duplicate send when concurrent instance holds an active lease", async () => {
    // Simulate active in-flight lease from another Vercel instance 5 seconds ago
    const activeLeaseTime = new Date(Date.now() - 5000).toISOString();

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "reservations") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              or: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: null, // Update matched 0 rows because another instance's lease is active
                error: null,
              }),
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "res-concurrent",
                  is_deposit_paid: true,
                  deposit_approved_notified_at: null,
                  deposit_approved_claim_at: activeLeaseTime,
                },
                error: null,
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex");

    const result = await notifyPaymentApproved("res-concurrent", { client: mockClient });

    // Second concurrent caller must skip without sending
    expect(result.ok).toBe(true);
    expect(result.already_notified).toBe(false);
    expect(sendLineFlexSpy).not.toHaveBeenCalled();
  });

  it("re-claims and retries if previous instance crashed and lease expired", async () => {
    // Simulate expired lease from a crashed instance (70 seconds ago, beyond 60s lease window)
    const expiredClaimTime = new Date(Date.now() - (DISPATCH_CLAIM_LEASE_MS + 10_000)).toISOString();

    const dbRow = {
      id: "res-crashed",
      customer_name: "黃先生",
      booking_code: "CRS123",
      start_time: "2026-09-10T14:00:00+08:00",
      end_time: "2026-09-10T16:00:00+08:00",
      deposit_payment_note: null,
      line_user_id: null,
      is_deposit_paid: true,
      deposit_approved_notified_at: null as string | null,
      deposit_approved_claim_at: expiredClaimTime,
    };

    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "reservations") {
          return {
            update: vi.fn((patch: Record<string, unknown>) => {
              Object.assign(dbRow, patch);
              return {
                eq: vi.fn().mockReturnThis(),
                is: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockImplementation(async () => {
                  return { data: { ...dbRow }, error: null };
                }),
              };
            }),
          };
        }
        if (table === "ops_events") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex").mockResolvedValue(undefined);

    const result = await notifyPaymentApproved("res-crashed", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(result.group_notified).toBe(true);
    expect(sendLineFlexSpy).toHaveBeenCalled();
    expect(dbRow.deposit_approved_notified_at).not.toBeNull();
  });

  it("aborts if deposit is not marked paid", async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "reservations") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              or: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "res-unpaid",
                  is_deposit_paid: false,
                  deposit_approved_notified_at: null,
                  deposit_approved_claim_at: null,
                },
                error: null,
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const result = await notifyPaymentApproved("res-unpaid", { client: mockClient });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("deposit_not_paid");
  });
});
