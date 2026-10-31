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
  readLineReminderDeliveryState: vi.fn(async () => "sent"),
  isReminderNoLongerRequired: vi.fn(async () => false),
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
  isLineConfigured,
  buildReminderDigestFlexChunks,
} from "@/lib/line-notify";
import { sendLineFlexMessage } from "@/lib/line";
import { REMINDER_DIGEST_CAROUSEL_MAX } from "@/lib/line-cards";
import { claimLineReminderDelivery, isReminderNoLongerRequired, markLineReminderDelivery, readLineReminderDeliveryState } from "@/lib/line-delivery";
import { findRecentSendLineHeartbeat, findSuccessfulSendLineRunToday } from "@/lib/job-runs";
import { LineSendError } from "@/lib/line-send-error";

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

  it("sends one digest per store when a guest has bookings at two stores", async () => {
    const row = (id: string, branchId: string, name: string) => ({
      id, booking_code: id, start_time: "2026-07-17T10:00:00+08:00", end_time: "2026-07-17T12:00:00+08:00",
      customer_name: "A", phone: "0912", line_user_id: "U1", is_deposit_paid: true,
      room: { name: "包廂1", branch_id: branchId, branch: { id: branchId, name } },
    });
    vi.mocked(fetchReservationsForReminder).mockResolvedValue(
      [row("d1", "b-daan", "大安店"), row("t1", "b-tongde", "同德店"), row("d2", "b-daan", "大安店")] as never
    );

    await runSendLineReminder({ sendHeartbeatOnEmpty: true, enforceDayIdempotency: true, trigger_source: "cron" });

    const guestCalls = vi.mocked(sendLineFlexMessage).mock.calls.filter(([, alt]) => String(alt).startsWith("明日訂位提醒"));
    expect(guestCalls.map((call) => call[3])).toEqual([{ reservationId: "d1" }, { reservationId: "t1" }]);
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
    expect(sendLineFlexMessage).toHaveBeenCalledWith("U1", "明日訂位提醒", expect.anything(), { reservationId: "p1" });

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


describe("independent staff and customer reminder delivery", () => {
  const row = {
    id: "r-isolation", booking_code: "TEST", start_time: "2026-10-22T10:00:00+08:00",
    end_time: "2026-10-22T12:00:00+08:00", customer_name: "Test", phone: "test",
    line_user_id: "U-test", room: { name: "Room", branch_id: "b1" },
  };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isLineConfigured).mockReturnValue(true);
    vi.mocked(buildReminderDigestFlexChunks).mockReturnValue([{ type: "bubble" }] as never);
    vi.mocked(fetchBranches).mockResolvedValue([{ id: "b1", name: "Test", line_group_id: "G-test" }] as never);
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([row] as never);
    vi.mocked(claimLineReminderDelivery).mockImplementation(async ({ reminderType, recipientId }) => ({ available: true, id: recipientId === "legacy-group" ? "d1_group_guard" : reminderType }));
    vi.mocked(readLineReminderDeliveryState).mockResolvedValue("sent");
    vi.mocked(isReminderNoLongerRequired).mockResolvedValue(false);
  });

  it.each(["quota", "configuration", "routing", "claim", "settlement"])("still sends to the customer after staff %s failure", async (failure) => {
    if (failure === "quota") vi.mocked(sendLineFlexToGroup).mockRejectedValue(new LineSendError("429 monthly limit", "rejected"));
    if (failure === "configuration") {
      vi.mocked(fetchBranches).mockResolvedValue([]);
      vi.mocked(isLineConfigured).mockReturnValue(false);
    }
    if (failure === "routing") vi.mocked(fetchBranches).mockRejectedValue(new Error("staff branch routing unavailable"));
    if (failure === "claim") vi.mocked(claimLineReminderDelivery).mockRejectedValueOnce(new Error("group claim unavailable"));
    if (failure === "settlement") vi.mocked(markLineReminderDelivery).mockImplementation(async (id) => {
      if (id === "d1_group") throw new Error("group settlement unavailable");
    });
    const result = await (await runSendLineReminder()).json();
    expect(sendLineFlexMessage).toHaveBeenCalledTimes(1);
    expect(result.guest_sent_count).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.result).toBe("partial");
    if (failure === "settlement") {
      expect(result.accepted_count).toBe(2);
      expect(result.rejected_count).toBe(0);
      expect(result.error).toContain("group settlement unavailable");
    }
    expect(updateReservationAdmin).toHaveBeenCalledWith(row.id, expect.objectContaining({ d1_guest_reminder_sent_at: expect.any(String) }));
  });

  it("does not invent a provider rejection or attempt for missing staff configuration", async () => {
    vi.mocked(fetchBranches).mockResolvedValue([]);
    vi.mocked(isLineConfigured).mockReturnValue(false);
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([{ ...row, line_user_id: null }] as never);
    const result = await (await runSendLineReminder()).json();
    expect(result.result).toBe("error");
    expect(result.error).toContain("LINE_CHANNEL_ACCESS_TOKEN");
    expect(result.accepted_count).toBe(0);
    expect(result.rejected_count).toBe(0);
    expect(result.delivery_certainty).toBe("not_attempted");
    expect(result.reminder_evidence.message_attempt_count).toBe(0);
  });

  it("retains earlier group acceptance when a later chunk claim fails", async () => {
    const rows = Array.from({ length: REMINDER_DIGEST_CAROUSEL_MAX + 1 }, (_, i) => ({ ...row, id: `chunk-${i}`, line_user_id: null }));
    vi.mocked(fetchReservationsForReminder).mockResolvedValue(rows as never);
    vi.mocked(claimLineReminderDelivery).mockImplementation(async ({ reservationId }) => {
      if (reservationId === `chunk-${REMINDER_DIGEST_CAROUSEL_MAX}`) throw new Error("later chunk claim unavailable");
      return { available: true, id: reservationId };
    });
    const result = await (await runSendLineReminder()).json();
    expect(sendLineFlexToGroup).toHaveBeenCalledTimes(1);
    expect(result.accepted_count).toBe(1);
    expect(result.rejected_count).toBe(0);
    expect(result.result).toBe("partial");
    expect(result.error).toContain("later chunk claim unavailable");
  });

  it("records customer rejection as failed and preserves its retry eligibility", async () => {
    vi.mocked(sendLineFlexMessage).mockRejectedValue(new LineSendError("429 customer monthly limit", "rejected"));
    const result = await (await runSendLineReminder()).json();
    expect(result.guest_sent_count).toBe(0);
    expect(result.ok).toBe(false);
    expect(markLineReminderDelivery).toHaveBeenCalledWith("d1_guest", expect.objectContaining({ status: "failed" }));
    expect(updateReservationAdmin).not.toHaveBeenCalledWith(row.id, expect.objectContaining({ d1_guest_reminder_sent_at: expect.anything() }));
  });

  it("does not resend a customer delivery whose durable claim is already handled", async () => {
    vi.mocked(claimLineReminderDelivery).mockImplementation(async ({ reminderType }) => ({ available: true, id: reminderType === "d1_guest" ? null : reminderType }));
    await runSendLineReminder();
    expect(sendLineFlexMessage).not.toHaveBeenCalled();
  });

  it("releases earlier claims when a later claim fails before the group push, allowing a later retry", async () => {
    const rows = [
      { ...row, id: "first", line_user_id: null },
      { ...row, id: "second", line_user_id: null },
    ];
    vi.mocked(fetchReservationsForReminder).mockResolvedValue(rows as never);
    let failSecond = true;
    const state = new Map<string, "sending" | "failed" | "sent">();
    vi.mocked(claimLineReminderDelivery).mockImplementation(async ({ reservationId, recipientId }) => {
      if (reservationId === "second" && failSecond) { failSecond = false; throw new Error("claim unavailable"); }
      const id = `${reservationId}:${recipientId}`;
      if (state.get(id) === "sending" || state.get(id) === "sent") return { available: true, id: null };
      state.set(id, "sending");
      return { available: true, id };
    });
    vi.mocked(markLineReminderDelivery).mockImplementation(async (id, result) => { state.set(id, result.status); });
    const first = await (await runSendLineReminder()).json();
    expect(sendLineFlexToGroup).not.toHaveBeenCalled();
    expect(state.get("first:legacy-group")).toBe("failed");
    expect(state.get("first:G-test")).toBe("failed");
    expect(first).toMatchObject({ accepted_count: 0, rejected_count: 0, delivery_certainty: "not_attempted" });
    const second = await (await runSendLineReminder()).json();
    expect(sendLineFlexToGroup).toHaveBeenCalledTimes(1);
    expect(second.accepted_count).toBe(1);
    expect(state.get("first:legacy-group")).toBe("sent");
    expect(state.get("first:G-test")).toBe("sent");
    expect(state.get("second:legacy-group")).toBe("sent");
    expect(state.get("second:G-test")).toBe("sent");
  });

  it.each(["group", "guest"])("keeps an unknown %s provider outcome held and never marks it failed", async (channel) => {
    const send = channel === "group" ? vi.mocked(sendLineFlexToGroup) : vi.mocked(sendLineFlexMessage);
    send.mockRejectedValue(new Error("connection dropped after request"));
    const result = await (await runSendLineReminder()).json();
    const heldId = channel === "group" ? "d1_group" : "d1_guest";
    expect(markLineReminderDelivery).not.toHaveBeenCalledWith(heldId, expect.anything());
    expect(result).toMatchObject({ unknown_attempt_count: 1, rejected_count: 0, delivery_certainty: "delivery_unknown" });
    expect(result.message).toContain("發送結果尚未確認");
    expect(result.reminder_evidence).toMatchObject({ message_attempt_count: 2, unknown_delivery_count: 2 });
    vi.mocked(claimLineReminderDelivery).mockResolvedValue({ available: true, id: null });
    vi.mocked(readLineReminderDeliveryState).mockImplementation(async ({ reminderType }) => reminderType === heldId ? "sending" : "sent");
    const again = await (await runSendLineReminder()).json();
    expect(send).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ ok: false, result: "error", accepted_count: 0, rejected_count: 0, unknown_attempt_count: 0, unresolved_claim_count: 1, delivery_certainty: "delivery_unknown" });
    expect(again.message).toContain("發送結果尚未確認");
    expect(again.reminder_evidence).toMatchObject({ message_attempt_count: 0, unresolved_claim_count: 1, delivery_certainty: "delivery_unknown" });
  });

  it("only treats lost claims as already notified when the ledger confirms sent", async () => {
    vi.mocked(claimLineReminderDelivery).mockResolvedValue({ available: true, id: null });
    vi.mocked(readLineReminderDeliveryState).mockResolvedValue("sent");
    const result = await (await runSendLineReminder()).json();
    expect(result).toMatchObject({ ok: true, result: "already_notified", unresolved_claim_count: 0 });
    expect(sendLineFlexToGroup).not.toHaveBeenCalled();
    expect(sendLineFlexMessage).not.toHaveBeenCalled();
  });

  it.each(["sending", "failed", "missing"] as const)("does not report an unresolved %s ledger row as already notified", async (state) => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([{ ...row, line_user_id: null }] as never);
    vi.mocked(claimLineReminderDelivery).mockResolvedValue({ available: true, id: null });
    vi.mocked(readLineReminderDeliveryState).mockResolvedValue(state);
    const result = await (await runSendLineReminder()).json();
    expect(result).toMatchObject({ ok: false, result: "error", unresolved_claim_count: 1, accepted_count: 0, rejected_count: 0 });
    expect(sendLineFlexToGroup).not.toHaveBeenCalled();
  });

  it("retains earlier guest acceptances when a later guest claim fails and releases the prior partial claim", async () => {
    vi.mocked(fetchBranches).mockResolvedValue([]);
    vi.mocked(isLineConfigured).mockReturnValue(false);
    const rows = [
      { ...row, id: "guest-a", line_user_id: "UA" },
      { ...row, id: "guest-b1", line_user_id: "UB" },
      { ...row, id: "guest-b2", line_user_id: "UB" },
    ];
    vi.mocked(fetchReservationsForReminder).mockResolvedValue(rows as never);
    vi.mocked(claimLineReminderDelivery).mockImplementation(async ({ reservationId }) => {
      if (reservationId === "guest-b2") throw new Error("guest claim unavailable");
      return { available: true, id: reservationId };
    });
    const result = await (await runSendLineReminder()).json();
    expect(sendLineFlexMessage).toHaveBeenCalledTimes(1);
    expect(markLineReminderDelivery).toHaveBeenCalledWith("guest-b1", expect.objectContaining({ status: "failed" }));
    expect(result).toMatchObject({ guest_sent_count: 1, accepted_count: 1, rejected_count: 0, result: "partial" });
    expect(result.error).toContain("guest claim unavailable");
    expect(result.reminder_evidence).toMatchObject({ accepted_count: 1, rejected_count: 0, message_attempt_count: 1 });
    expect(result.reminder_evidence.status).toBe("partial");
  });

  it("keeps partial evidence when one recipient is accepted and another claim is unresolved", async () => {
    vi.mocked(claimLineReminderDelivery).mockImplementation(async ({ reminderType }) => ({ available: true, id: reminderType === "d1_guest" ? null : reminderType }));
    vi.mocked(readLineReminderDeliveryState).mockResolvedValue("sending");
    const result = await (await runSendLineReminder()).json();
    expect(result).toMatchObject({ ok: false, result: "partial", accepted_count: 1, unresolved_claim_count: 1 });
    expect(result.reminder_evidence).toMatchObject({ status: "partial", unresolved_claim_count: 1 });
  });

  it("keeps the legacy guard held after an unknown legacy send when a branch is configured", async () => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([{ ...row, line_user_id: null }] as never);
    vi.mocked(fetchBranches).mockResolvedValueOnce([] as never);
    const ledger = new Map<string, "sending" | "sent" | "failed">();
    vi.mocked(claimLineReminderDelivery).mockImplementation(async ({ recipientId }) => {
      if (ledger.get(recipientId) === "sending" || ledger.get(recipientId) === "sent") return { available: true, id: null };
      ledger.set(recipientId, "sending");
      return { available: true, id: recipientId };
    });
    vi.mocked(readLineReminderDeliveryState).mockImplementation(async ({ recipientId }) => ledger.get(recipientId) ?? "missing");
    const { sendLineFlex } = await import("@/lib/line-notify");
    vi.mocked(sendLineFlex).mockRejectedValueOnce(new Error("connection dropped"));
    const first = await (await runSendLineReminder()).json();
    expect(first.unknown_attempt_count).toBe(1);
    const second = await (await runSendLineReminder()).json();
    expect(second).toMatchObject({ ok: false, unresolved_claim_count: 1 });
    expect(sendLineFlexToGroup).not.toHaveBeenCalled();
    expect(ledger.get("legacy-group")).toBe("sending");
    expect(ledger.has("G-test")).toBe(false);
  });

  it("does not bind a historic legacy success to an unproven branch recipient", async () => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([{ ...row, line_user_id: null }] as never);
    vi.mocked(claimLineReminderDelivery).mockResolvedValue({ available: true, id: null });
    vi.mocked(readLineReminderDeliveryState).mockImplementation(async ({ recipientId }) => recipientId === "legacy-group" ? "sent" : "missing");
    const result = await (await runSendLineReminder()).json();
    expect(result).toMatchObject({ ok: false, unresolved_claim_count: 1 });
    expect(sendLineFlexToGroup).not.toHaveBeenCalled();
  });

  it("releases the guard if the branch claim fails before any provider request", async () => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([{ ...row, line_user_id: null }] as never);
    vi.mocked(claimLineReminderDelivery).mockImplementation(async ({ recipientId }) => {
      if (recipientId !== "legacy-group") throw new Error("branch claim unavailable");
      return { available: true, id: "guard" };
    });
    const result = await (await runSendLineReminder()).json();
    expect(result).toMatchObject({ ok: false, accepted_count: 0 });
    expect(markLineReminderDelivery).toHaveBeenCalledWith("guard", expect.objectContaining({ status: "failed" }));
    expect(sendLineFlexToGroup).not.toHaveBeenCalled();
  });

  it("keeps the guard held when branch delivery is already in flight", async () => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([{ ...row, line_user_id: null }] as never);
    vi.mocked(claimLineReminderDelivery).mockImplementation(async ({ recipientId }) => ({ available: true, id: recipientId === "legacy-group" ? "guard" : null }));
    vi.mocked(readLineReminderDeliveryState).mockResolvedValue("sending");
    const result = await (await runSendLineReminder()).json();
    expect(result).toMatchObject({ ok: false, unresolved_claim_count: 1 });
    expect(markLineReminderDelivery).not.toHaveBeenCalledWith("guard", expect.anything());
    expect(sendLineFlexToGroup).not.toHaveBeenCalled();
  });

  it("never releases a guard after a previous matching branch send is confirmed", async () => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([{ ...row, line_user_id: null }] as never);
    vi.mocked(claimLineReminderDelivery).mockImplementation(async ({ recipientId }) => ({ available: true, id: recipientId === "legacy-group" ? "guard" : null }));
    vi.mocked(readLineReminderDeliveryState).mockResolvedValue("sent");
    vi.mocked(markLineReminderDelivery).mockRejectedValue(new Error("database unavailable"));
    const result = await (await runSendLineReminder()).json();
    expect(result.ok).toBe(false);
    expect(markLineReminderDelivery).not.toHaveBeenCalledWith("guard", expect.objectContaining({ status: "failed" }));
    expect(sendLineFlexToGroup).not.toHaveBeenCalled();
  });

  it.each(["group", "guest"])("accepts a missing %s claim when the current reservation no longer needs it", async (channel) => {
    vi.mocked(claimLineReminderDelivery).mockImplementation(async ({ reminderType }) => ({ available: true, id: reminderType === (channel === "group" ? "d1_group" : "d1_guest") ? null : reminderType }));
    vi.mocked(readLineReminderDeliveryState).mockResolvedValue("missing");
    vi.mocked(isReminderNoLongerRequired).mockResolvedValue(true);
    const result = await (await runSendLineReminder({ force: true })).json();
    expect(result.unresolved_claim_count).toBe(0);
    if (channel === "group") expect(sendLineFlexToGroup).not.toHaveBeenCalled();
    else expect(sendLineFlexMessage).not.toHaveBeenCalled();
  });

  it("does not clear a sending claim even if the reservation is now marked complete", async () => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([{ ...row, line_user_id: null }] as never);
    vi.mocked(claimLineReminderDelivery).mockResolvedValue({ available: true, id: null });
    vi.mocked(readLineReminderDeliveryState).mockResolvedValue("sending");
    vi.mocked(isReminderNoLongerRequired).mockResolvedValue(true);
    const result = await (await runSendLineReminder()).json();
    expect(result).toMatchObject({ ok: false, unresolved_claim_count: 1 });
    expect(isReminderNoLongerRequired).not.toHaveBeenCalled();
  });

  it.each(["settlement", "marker"])("records an accepted guest push when its %s write fails", async (failure) => {
    if (failure === "settlement") vi.mocked(markLineReminderDelivery).mockImplementation(async (id) => {
      if (id === "d1_guest") throw new Error("guest settlement unavailable");
    });
    if (failure === "marker") vi.mocked(updateReservationAdmin).mockImplementation(async (_id, patch) => {
      if ("d1_guest_reminder_sent_at" in patch) throw new Error("guest marker unavailable");
      return {} as never;
    });
    const result = await (await runSendLineReminder()).json();
    expect(result).toMatchObject({ guest_sent_count: 1, accepted_count: 2, rejected_count: 0, result: "partial", guest_error_count: 1 });
    expect(result.error).toContain(failure === "marker" ? "guest marker unavailable" : "guest settlement unavailable");
    expect(markLineReminderDelivery).not.toHaveBeenCalledWith("d1_guest", expect.objectContaining({ status: "failed" }));
  });

  it.each(["configuration", "payload"])("does not report local group %s failure as a LINE rejection", async (failure) => {
    vi.mocked(fetchReservationsForReminder).mockResolvedValue([{ ...row, line_user_id: null }] as never);
    if (failure === "configuration") vi.mocked(sendLineFlexToGroup).mockRejectedValue(new LineSendError("missing token", "not_sent"));
    else vi.mocked(buildReminderDigestFlexChunks).mockImplementation(() => { throw new Error("payload construction failed"); });
    const result = await (await runSendLineReminder()).json();
    expect(result).toMatchObject({ accepted_count: 0, rejected_count: 0, unknown_attempt_count: 0, delivery_certainty: "not_attempted" });
    expect(result.reminder_evidence.message_attempt_count).toBe(0);
    expect(markLineReminderDelivery).toHaveBeenCalledWith("d1_group", expect.objectContaining({ status: "failed" }));
  });
});
