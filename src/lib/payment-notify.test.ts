import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyPaymentApproved, __resetPaymentNotifyInFlightForTests } from "./payment-notify";
import * as lineNotify from "./line-notify";
import * as line from "./line";
import * as opsLog from "./ops-log";

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

  it("skips send if already notified according to ops_events", async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "ops_events") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            contains: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "existing-event-id" },
              error: null,
            }),
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

  it("sends both group and guest notifications on fresh approval", async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "ops_events") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            contains: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === "reservations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
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
              },
              error: null,
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage").mockResolvedValue(undefined);
    const logOpsSpy = vi.spyOn(opsLog, "logOps");

    const result = await notifyPaymentApproved("res-123", { client: mockClient, actor: "test_suite" });

    expect(result.ok).toBe(true);
    expect(result.group_notified).toBe(true);
    expect(result.guest_notified).toBe(true);
    expect(sendLineFlexSpy).toHaveBeenCalledWith(
      expect.stringContaining("客人已付訂金：林小姐"),
      expect.any(Object)
    );
    expect(sendLineFlexMessageSpy).toHaveBeenCalledWith(
      "U1234567890",
      "訂金已確認",
      expect.any(Object)
    );
    expect(logOpsSpy).toHaveBeenCalledWith(
      "payment",
      "payment.approved_notified",
      expect.objectContaining({
        reservation_id: "res-123",
        booking_code: "XYZ789",
        guest_notified: true,
        group_notified: true,
        actor: "test_suite",
      })
    );
  });

  it("handles guest without line_user_id by only notifying group", async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "ops_events") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            contains: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === "reservations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "res-456",
                customer_name: "王先生",
                booking_code: "ABC456",
                start_time: "2026-09-10T14:00:00+08:00",
                end_time: "2026-09-10T16:00:00+08:00",
                deposit_payment_note: null,
                line_user_id: null,
                is_deposit_paid: true,
              },
              error: null,
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const sendLineFlexSpy = vi.spyOn(lineNotify, "sendLineFlex").mockResolvedValue(undefined);
    const sendLineFlexMessageSpy = vi.spyOn(line, "sendLineFlexMessage");
    const logOpsSpy = vi.spyOn(opsLog, "logOps");

    const result = await notifyPaymentApproved("res-456", { client: mockClient });

    expect(result.ok).toBe(true);
    expect(result.group_notified).toBe(true);
    expect(result.guest_notified).toBe(false);
    expect(sendLineFlexSpy).toHaveBeenCalled();
    expect(sendLineFlexMessageSpy).not.toHaveBeenCalled();
    expect(logOpsSpy).toHaveBeenCalledWith(
      "payment",
      "payment.approved_notified",
      expect.objectContaining({
        reservation_id: "res-456",
        guest_notified: false,
        line_user_id: null,
      })
    );
  });

  it("aborts if deposit is not marked paid", async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === "ops_events") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            contains: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        if (table === "reservations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "res-unpaid",
                is_deposit_paid: false,
              },
              error: null,
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
