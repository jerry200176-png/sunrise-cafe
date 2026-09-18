import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  isAdminConfigured: vi.fn(() => true),
  fetchBranches: vi.fn(),
  fetchReservationsForReminder: vi.fn(),
  fetchTomorrowsReservations: vi.fn(),
  updateReservationAdmin: vi.fn(async () => ({})),
}));

vi.mock("@/lib/line-notify", () => ({
  isLineConfigured: vi.fn(() => true),
  sendLineMessage: vi.fn(async () => {}),
  sendLineMessageToGroup: vi.fn(async () => {}),
  sendLineFlex: vi.fn(async () => {}),
  sendLineFlexToGroup: vi.fn(async () => {}),
  buildReminderDigestFlexChunks: vi.fn(() => [{ type: "bubble" }]),
}));

vi.mock("@/lib/line", () => ({
  sendLineFlexMessage: vi.fn(async () => {}),
  buildReminderFlex: vi.fn(() => ({ type: "bubble" })),
}));

vi.mock("@/lib/line-delivery", () => ({
  claimLineReminderDelivery: vi.fn(async () => ({ available: false, id: null })),
  markLineReminderDelivery: vi.fn(async () => {}),
  safeLineDeliveryError: vi.fn((error: unknown) => String(error)),
}));

vi.mock("@/lib/attendance-token", () => ({
  signAttendanceToken: vi.fn(() => "tok"),
}));

vi.mock("@/lib/lookup-token", () => ({
  signLookupToken: vi.fn(() => "lookup-tok"),
}));

vi.mock("@/lib/job-runs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/job-runs")>("@/lib/job-runs");
  return {
    ...actual,
    findSuccessfulSendLineRunToday: vi.fn(async () => null),
    findRecentSendLineHeartbeat: vi.fn(async () => false),
  };
});

import {
  alreadyNotifiedCronMessage,
  emptyCatMessage,
  runSendLineReminder,
} from "./send-line-reminder";
import {
  fetchBranches,
  fetchReservationsForReminder,
  fetchTomorrowsReservations,
  updateReservationAdmin,
} from "@/lib/supabase-admin";
import {
  sendLineMessage,
  sendLineMessageToGroup,
  sendLineFlexToGroup,
} from "@/lib/line-notify";
import { sendLineFlexMessage } from "@/lib/line";
import { findRecentSendLineHeartbeat, findSuccessfulSendLineRunToday } from "@/lib/job-runs";

describe("alreadyNotifiedCronMessage / emptyCatMessage", () => {
  it("includes count and is stable shape", () => {
    const msg = alreadyNotifiedCronMessage(3, new Date("2026-07-16T12:00:00Z"));
    expect(msg).toContain("共 3 筆");
    expect(msg).toContain("皆已通知過");
  });

  it("picks a cat message", () => {
    expect(emptyCatMessage(() => 0)).toContain("喵");
  });
});

describe("runSendLineReminder — sent=0 regression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Scheduled tests run inside the valid Vercel cron window.
    vi.setSystemTime(new Date("2026-09-04T12:30:00.000Z"));
    vi.clearAllMocks();
    vi.mocked(findSuccessfulSendLineRunToday).mockResolvedValue(null);
    vi.mocked(findRecentSendLineHeartbeat).mockResolvedValue(false);
    vi.mocked(fetchBranches).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends already-notified heartbeat instead of silence when tomorrow exists", async () => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([]);
    vi.mocked(fetchTomorrowsReservations).mockResolvedValue([
      { id: "r1", is_notified: true, is_deposit_paid: true },
      { id: "r2", is_notified: true, is_deposit_paid: true },
    ] as never);

    const res = await runSendLineReminder({
      sendHeartbeatOnEmpty: true,
      trigger_source: "cron",
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sent).toBe(1);
    expect(json.result).toBe("already_notified");
    expect(json.heartbeat).toBe("already_notified");
    expect(sendLineMessage).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(sendLineMessage).mock.calls[0]![0])).toContain("皆已通知過");
  });

  it("sends cat message when no tomorrow reservations", async () => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([]);
    vi.mocked(fetchTomorrowsReservations).mockResolvedValue([]);

    const res = await runSendLineReminder({
      sendHeartbeatOnEmpty: true,
      trigger_source: "cron",
    });
    const json = await res.json();

    expect(json.result).toBe("empty_cat");
    expect(json.heartbeat).toBe("cat");
    expect(sendLineMessage).toHaveBeenCalledTimes(1);
  });

  it("cooldowns an unchanged empty state without removing the heartbeat path", async () => {
    vi.mocked(findRecentSendLineHeartbeat).mockResolvedValue(true);
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([]);
    vi.mocked(fetchTomorrowsReservations).mockResolvedValue([]);

    const res = await runSendLineReminder({
      sendHeartbeatOnEmpty: true,
      trigger_source: "cron",
    });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.sent).toBe(0);
    expect(json.heartbeat).toBe("already_notified");
    expect(sendLineMessage).not.toHaveBeenCalled();
  });

  it("does not turn a reservation query failure into a cat message", async () => {
    vi.mocked(fetchReservationsForReminder).mockRejectedValue(
      new Error("Supabase reservations unavailable")
    );

    const res = await runSendLineReminder({
      sendHeartbeatOnEmpty: true,
      trigger_source: "cron",
    });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.result).toBe("error");
    expect(json.error).toContain("Supabase reservations unavailable");
    expect(sendLineMessage).not.toHaveBeenCalled();
  });

  it("does not turn the all-tomorrow verification failure into a cat message", async () => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([]);
    vi.mocked(fetchTomorrowsReservations).mockRejectedValue(
      new Error("Supabase tomorrow query unavailable")
    );

    const res = await runSendLineReminder({
      sendHeartbeatOnEmpty: true,
      trigger_source: "cron",
    });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.result).toBe("error");
    expect(json.error).toContain("Supabase tomorrow query unavailable");
    expect(sendLineMessage).not.toHaveBeenCalled();
  });

  it("sends an already-notified heartbeat when tomorrow has unpaid reservations", async () => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([]);
    vi.mocked(fetchTomorrowsReservations).mockResolvedValue([
      { id: "unpaid-1", is_notified: false, is_deposit_paid: false },
    ] as never);

    const res = await runSendLineReminder({
      sendHeartbeatOnEmpty: true,
      trigger_source: "cron",
    });
    const json = await res.json();

    expect(json.result).toBe("already_notified");
    expect(json.sent).toBe(1);
    expect(sendLineMessage).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(sendLineMessage).mock.calls[0]![0])).toContain("共 1 筆");
  });
});

describe("runSendLineReminder — duplicated cron regression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // GitHub backup runs after the primary Vercel window.
    vi.setSystemTime(new Date("2026-09-04T13:30:00.000Z"));
    vi.clearAllMocks();
    vi.mocked(fetchBranches).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips LINE when a successful run already exists today", async () => {
    vi.mocked(findSuccessfulSendLineRunToday).mockResolvedValue({
      id: "prior-1",
      started_at: "2026-07-16T12:05:00Z",
      metadata: { result: "sent" },
    });

    const res = await runSendLineReminder({
      sendHeartbeatOnEmpty: true,
      enforceDayIdempotency: true,
      trigger_source: "github",
    });
    const json = await res.json();

    expect(json.result).toBe("duplicate_skip");
    expect(json.duplicate).toBe(true);
    expect(sendLineMessage).not.toHaveBeenCalled();
    expect(sendLineFlexToGroup).not.toHaveBeenCalled();
    expect(fetchReservationsForReminder).not.toHaveBeenCalled();
  });
});

describe("runSendLineReminder — retry regression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:30:00.000Z"));
    vi.clearAllMocks();
    vi.mocked(findSuccessfulSendLineRunToday).mockResolvedValue(null);
    vi.mocked(fetchBranches).mockResolvedValue([
      { id: "b1", name: "大安店", line_group_id: "G123" },
    ] as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips a delayed scheduled run after midnight without querying or sending", async () => {
    vi.setSystemTime(new Date("2026-09-04T16:52:31.938Z"));

    const res = await runSendLineReminder({
      sendHeartbeatOnEmpty: true,
      enforceDayIdempotency: true,
      trigger_source: "github",
    });
    const json = await res.json();

    expect(json.result).toBe("schedule_window_skip");
    expect(json.taipei_date).toBe("2026-09-05");
    expect(json.sent_count).toBe(0);
    expect(fetchReservationsForReminder).not.toHaveBeenCalled();
    expect(fetchTomorrowsReservations).not.toHaveBeenCalled();
    expect(sendLineMessage).not.toHaveBeenCalled();
    expect(sendLineFlexToGroup).not.toHaveBeenCalled();
  });

  it("only sends pending rows and marks them notified (idempotent retry)", async () => {
    const pending = [
      {
        id: "p1",
        booking_code: "A1",
        start_time: "2026-07-17T10:00:00+08:00",
        end_time: "2026-07-17T12:00:00+08:00",
        customer_name: "A",
        phone: "0912",
        line_user_id: "U1",
        is_deposit_paid: true,
        room: { name: "包廂1", branch_id: "b1", branch: { id: "b1", name: "大安店" } },
      },
    ];
    vi.mocked(fetchReservationsForReminder).mockResolvedValue(pending as never);

    const res = await runSendLineReminder({
      sendHeartbeatOnEmpty: true,
      enforceDayIdempotency: true,
      trigger_source: "cron",
    });
    const json = await res.json();

    expect(json.result).toBe("sent");
    expect(json.sent_count).toBe(2);
    expect(json.guest_sent_count).toBe(1);
    expect(sendLineFlexToGroup).toHaveBeenCalled();
    expect(updateReservationAdmin).toHaveBeenCalledWith("p1", { is_notified: true });
    expect(sendLineFlexMessage).toHaveBeenCalledWith("U1", "明日訂位提醒", expect.anything());

    // Second call with empty pending = already notified path, no digest re-send
    vi.clearAllMocks();
    vi.mocked(findSuccessfulSendLineRunToday).mockResolvedValue(null);
    vi.mocked(fetchBranches).mockResolvedValue([
      { id: "b1", name: "大安店", line_group_id: "G123" },
    ] as never);
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([]);
    vi.mocked(fetchTomorrowsReservations).mockResolvedValue([
      {
        id: "p1",
        is_deposit_paid: true,
        room: { name: "包廂1", branch_id: "b1", branch: { id: "b1", name: "大安店" } },
      },
    ] as never);

    const res2 = await runSendLineReminder({
      sendHeartbeatOnEmpty: true,
      enforceDayIdempotency: false,
      trigger_source: "cron",
    });
    const json2 = await res2.json();
    expect(json2.result).toBe("already_notified");
    expect(sendLineFlexToGroup).not.toHaveBeenCalled();
    expect(sendLineMessageToGroup).toHaveBeenCalled();
  });

  it("batches multiple D-1 reservations for one guest into one personal push", async () => {
    vi.mocked(fetchBranches).mockResolvedValue([
      { id: "b1", name: "大安店", line_group_id: "G123" },
    ] as never);
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([
      {
        id: "p1",
        booking_code: "A1",
        start_time: "2026-07-17T10:00:00+08:00",
        end_time: "2026-07-17T12:00:00+08:00",
        customer_name: "A",
        phone: "0912",
        line_user_id: "U1",
        is_deposit_paid: true,
        room: { name: "包廂1", branch_id: "b1", branch: { id: "b1", name: "大安店" } },
      },
      {
        id: "p2",
        booking_code: "A2",
        start_time: "2026-07-17T14:00:00+08:00",
        end_time: "2026-07-17T16:00:00+08:00",
        customer_name: "A",
        phone: "0912",
        line_user_id: "U1",
        is_deposit_paid: true,
        room: { name: "包廂2", branch_id: "b1", branch: { id: "b1", name: "大安店" } },
      },
    ] as never);

    const res = await runSendLineReminder({ trigger_source: "cron" });
    const json = await res.json();

    expect(json.sent_count).toBe(2);
    expect(json.guest_sent_count).toBe(1);
    expect(sendLineFlexMessage).toHaveBeenCalledTimes(1);
  });

  it("includes unpaid reservations in the group reminder", async () => {
    const unpaid = {
      id: "unpaid-1",
      booking_code: "UNPAID",
      start_time: "2026-07-17T10:00:00+08:00",
      end_time: "2026-07-17T12:00:00+08:00",
      customer_name: "Unpaid",
      phone: "0912",
      line_user_id: null,
      is_deposit_paid: false,
      room: { name: "包廂1", branch_id: "b1", branch: { id: "b1", name: "大安店" } },
    };
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([unpaid] as never);

    const res = await runSendLineReminder({
      enforceDayIdempotency: true,
      trigger_source: "cron",
    });
    const json = await res.json();

    expect(json.sent_count).toBe(1);
    expect(json.guest_sent_count).toBe(0);
    expect(sendLineFlexToGroup).toHaveBeenCalledTimes(1);
    expect(updateReservationAdmin).toHaveBeenCalledWith("unpaid-1", { is_notified: true });
  });
});
