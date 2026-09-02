/**
 * Tomorrow LINE reminder core — idempotent, observable, heartbeat on empty/already-notified.
 */
import { NextResponse } from "next/server";
import {
  fetchReservationsForReminder,
  fetchTomorrowsReservations,
  fetchBranches,
  updateReservationAdmin,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import {
  sendLineMessageToGroup,
  sendLineMessage,
  sendLineFlexToGroup,
  sendLineFlex,
  buildReminderDigestFlexChunks,
  isLineConfigured,
} from "@/lib/line-notify";
import { sendLineFlexMessage } from "@/lib/line";
import {
  buildGuestReminderDigestFlexChunks,
  REMINDER_DIGEST_CAROUSEL_MAX,
} from "@/lib/line-cards";
import { errorToDetail } from "@/lib/cron-alert";
import { reservationMatchesBranch, type ReminderReservationShape } from "@/lib/reminder-branch-match";
import { signAttendanceToken } from "@/lib/attendance-token";
import { LINE_SITE_URL } from "@/lib/line-flex";
import { taipeiDateString } from "@/lib/datetime";
import {
  findSuccessfulSendLineRunToday,
  type ReminderTriggerSource,
} from "@/lib/job-runs";
import {
  buildReminderRunEvidence,
  mapTriggerToSource,
} from "@/lib/reminder-run-evidence";
import {
  claimLineReminderDelivery,
  markLineReminderDelivery,
  safeLineDeliveryError,
  type LineReminderDeliveryType,
} from "@/lib/line-delivery";

export const CAT_MESSAGES = [
  "喵～沒訂位！Ivy 妳備好零食了嗎？本喵五分鐘後到 🐱",
  "喵！明日空班。御碩你欠我一罐罐頭，記帳了喔 🐾",
  "明天空班。鄭昇老師你的膝蓋今晚已被本喵預約，請勿臨時取消 ฅ(＾・ω・＾ฅ)",
  "喵嗚～沒訂位。Maggie 妳的零食是我的，妳的外套也是我的，其實妳所有東西都是我的 🐱",
  "明日無訂位。本喵將展開全店巡邏，所有椅子都是我的，不要攔我 🐾",
];

export type ReminderHeartbeat = "digest" | "cat" | "already_notified" | "duplicate_skip" | "none";

export type ReminderRunObservability = {
  trigger_source: ReminderTriggerSource;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  reservation_count: number;
  sent_count: number;
  skipped_count: number;
  guest_sent_count: number;
  result: "sent" | "already_notified" | "empty_cat" | "duplicate_skip" | "error" | "partial";
  error: string | null;
  heartbeat: ReminderHeartbeat;
  taipei_date: string;
  duplicate: boolean;
  /** Phase 1: LINE acceptance ≠ end-user delivery */
  accepted_count: number;
  rejected_count: number;
  delivery_certainty: "accepted_by_line" | "rejected_by_line" | "delivery_unknown" | "not_attempted";
};

export type BranchRow = { id: string; name: string; line_group_id?: string | null };

export function alreadyNotifiedCronMessage(count: number, now = new Date()): string {
  const when = now.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
  return `📅 明日訂位提醒已執行\n共 ${count} 筆訂位，皆已通知過（無需重送）\n時間：${when}`;
}

export function emptyCatMessage(rng = Math.random): string {
  return CAT_MESSAGES[Math.floor(rng() * CAT_MESSAGES.length)]!;
}

function toEnriched(r: Record<string, unknown>) {
  const room = r.room as { name?: string; branch?: { name?: string } } | undefined;
  return {
    booking_code: r.booking_code as string,
    room_name: room?.name ?? "—",
    branch_name: room?.branch?.name ?? "—",
    start_time: r.start_time as string,
    end_time: r.end_time as string,
    customer_name: r.customer_name as string,
    phone: r.phone as string,
    guest_count: r.guest_count as number | null | undefined,
    notes: r.notes as string | null | undefined,
  };
}

function reminderDate(row: Record<string, unknown>): string {
  return taipeiDateString(new Date(String(row.start_time)));
}

type ClaimedRow = { row: Record<string, unknown>; deliveryId: string | null };
type ClaimRowsResult = { toSend: ClaimedRow[]; handledRows: Record<string, unknown>[] };

async function claimRows(
  rows: Record<string, unknown>[],
  reminderType: LineReminderDeliveryType,
  reminderDateValue: string,
  recipientType: "group" | "guest",
  recipientId: string
): Promise<ClaimRowsResult> {
  const toSend: ClaimedRow[] = [];
  const handledRows: Record<string, unknown>[] = [];
  for (const row of rows) {
    const result = await claimLineReminderDelivery({
      reminderType,
      reminderDate: reminderDateValue,
      reservationId: String(row.id),
      recipientType,
      recipientId,
    });
    // Before the migration is available, preserve the old flag-based behavior.
    // Once the ledger exists, only an explicit claim may send.
    if (!result.available || result.id) toSend.push({ row, deliveryId: result.id });
    else handledRows.push(row);
  }
  return { toSend, handledRows };
}

async function settleClaims(claimed: ClaimedRow[], status: "sent" | "failed", error?: unknown) {
  await Promise.all(
    claimed
      .filter((item) => item.deliveryId)
      .map((item) =>
        markLineReminderDelivery(item.deliveryId!, {
          status,
          error: status === "failed" ? safeLineDeliveryError(error) : null,
        })
      )
  );
}

async function pushDigestToGroup(
  rows: Record<string, unknown>[],
  groupId: string | null,
  labelPrefix: string,
  reminderType: "d1_group" = "d1_group"
) {
  const sentRows: Record<string, unknown>[] = [];
  const handledRows: Record<string, unknown>[] = [];
  let messageCount = 0;
  let errorCount = 0;
  const recipientId = groupId ?? "legacy-group";
  const date = reminderDate(rows[0]!);
  for (let offset = 0; offset < rows.length; offset += REMINDER_DIGEST_CAROUSEL_MAX) {
    const rowChunk = rows.slice(offset, offset + REMINDER_DIGEST_CAROUSEL_MAX);
    const claims = await claimRows(rowChunk, reminderType, date, "group", recipientId);
    handledRows.push(...claims.handledRows);
    if (claims.toSend.length === 0) continue;
    const claimed = claims.toSend;
    handledRows.push(...claimed.map((item) => item.row));
    const enriched = claimed.map((item) => toEnriched(item.row));
    const part = rows.length > REMINDER_DIGEST_CAROUSEL_MAX
      ? `（${Math.floor(offset / REMINDER_DIGEST_CAROUSEL_MAX) + 1}/${Math.ceil(rows.length / REMINDER_DIGEST_CAROUSEL_MAX)}）`
      : "";
    const alt = `${labelPrefix}，共 ${rows.length} 筆${part}`;
    let accepted = false;
    try {
      const [chunk] = buildReminderDigestFlexChunks(enriched);
      if (groupId) await sendLineFlexToGroup(alt, chunk!, groupId);
      else await sendLineFlex(alt, chunk!);
      accepted = true;
      messageCount++;
      await settleClaims(claimed, "sent");
      await Promise.all(
        claimed.map((item) => updateReservationAdmin(String(item.row.id), { is_notified: true }))
      );
      sentRows.push(...claimed.map((item) => item.row));
    } catch (error) {
      errorCount++;
      await settleClaims(claimed, accepted ? "sent" : "failed", error);
      console.error(`[send-line] 群組摘要傳送失敗: ${safeLineDeliveryError(error)}`);
    }
  }
  return { sent: messageCount, errors: errorCount, rows: sentRows, handled: handledRows };
}

async function pushTextToGroups(
  text: string,
  activeBranches: BranchRow[],
  useLegacyMode: boolean
) {
  if (useLegacyMode) {
    await sendLineMessage(text);
    return;
  }
  await Promise.all(
    activeBranches.map((branch) =>
      sendLineMessageToGroup(text, branch.line_group_id!).catch((e) =>
        console.error(`[send-line] status msg failed for branch ${branch.name}:`, e)
      )
    )
  );
}

export type SendLineReminderOptions = {
  force?: boolean;
  /** Cron/GitHub GET: send cat or already-notified heartbeat when nothing pending */
  sendHeartbeatOnEmpty?: boolean;
  /** Enforce same-day idempotency (skip LINE if cron already succeeded today) */
  enforceDayIdempotency?: boolean;
  trigger_source?: ReminderTriggerSource;
};

function obsBase(
  trigger: ReminderTriggerSource,
  started: Date
): Pick<ReminderRunObservability, "trigger_source" | "started_at" | "taipei_date"> {
  return {
    trigger_source: trigger,
    started_at: started.toISOString(),
    taipei_date: taipeiDateString(started),
  };
}

function finalizeObs(
  partial: ReturnType<typeof obsBase> &
    Partial<ReminderRunObservability> & {
      reservation_count: number;
      sent_count: number;
      skipped_count: number;
      guest_sent_count: number;
      result: ReminderRunObservability["result"];
      heartbeat: ReminderHeartbeat;
      duplicate: boolean;
      error?: string | null;
      accepted_count?: number;
      rejected_count?: number;
    },
  started: Date
): ReminderRunObservability & { reminder_evidence: ReturnType<typeof buildReminderRunEvidence> } {
  const finished = new Date();
  const accepted_count = partial.accepted_count ?? (partial.result === "error" ? 0 : partial.sent_count);
  const rejected_count = partial.rejected_count ?? (partial.result === "error" ? 1 : 0);
  const delivery_certainty: ReminderRunObservability["delivery_certainty"] =
    accepted_count > 0
      ? "delivery_unknown"
      : rejected_count > 0
        ? "rejected_by_line"
        : "not_attempted";
  const observability: ReminderRunObservability = {
    trigger_source: partial.trigger_source,
    started_at: partial.started_at,
    finished_at: finished.toISOString(),
    duration_ms: finished.getTime() - started.getTime(),
    reservation_count: partial.reservation_count,
    sent_count: partial.sent_count,
    skipped_count: partial.skipped_count,
    guest_sent_count: partial.guest_sent_count,
    result: partial.result,
    error: partial.error ?? null,
    heartbeat: partial.heartbeat,
    taipei_date: partial.taipei_date,
    duplicate: partial.duplicate,
    accepted_count,
    rejected_count,
    delivery_certainty,
  };
  const reminder_evidence = buildReminderRunEvidence({
    invoked_at: observability.started_at,
    source: mapTriggerToSource(observability.trigger_source),
    candidate_reservation_count: observability.reservation_count,
    recipient_count: Math.max(observability.sent_count, observability.guest_sent_count),
    message_attempt_count: accepted_count + rejected_count,
    accepted_count,
    rejected_count,
    duplicate_suppressed_count: observability.duplicate ? 1 : 0,
    result:
      observability.result === "error" && rejected_count > 0 && accepted_count > 0
        ? "partial"
        : observability.result === "error"
          ? "error"
          : observability.result === "duplicate_skip"
            ? "duplicate_skip"
            : observability.result === "empty_cat"
              ? "empty_cat"
              : observability.result === "already_notified"
                ? "already_notified"
                : accepted_count > 0 && rejected_count > 0
                  ? "partial"
                  : "sent",
    error: observability.error,
  });
  return { ...observability, reminder_evidence };
}

/** Core handler used by GET (cron) and POST (manual). */
export async function runSendLineReminder(
  options: SendLineReminderOptions = {}
): Promise<NextResponse> {
  const force = options.force ?? false;
  const sendHeartbeatOnEmpty = options.sendHeartbeatOnEmpty ?? false;
  const enforceDayIdempotency = options.enforceDayIdempotency ?? false;
  const trigger_source = options.trigger_source ?? "manual";
  const started = new Date();
  const base = obsBase(trigger_source, started);

  if (!isAdminConfigured()) {
    const observability = finalizeObs(
      {
        ...base,
        reservation_count: 0,
        sent_count: 0,
        skipped_count: 0,
        guest_sent_count: 0,
        result: "error",
        heartbeat: "none",
        duplicate: false,
        error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY",
      },
      started
    );
    return NextResponse.json({ ok: false, ...observability }, { status: 503 });
  }

  try {
    // Same-day idempotency for scheduled triggers (cron / github backup)
    if (enforceDayIdempotency) {
      const prior = await findSuccessfulSendLineRunToday(started);
      if (prior) {
        const observability = finalizeObs(
          {
            ...base,
            reservation_count: 0,
            sent_count: 0,
            skipped_count: 0,
            guest_sent_count: 0,
            result: "duplicate_skip",
            heartbeat: "duplicate_skip",
            duplicate: true,
            error: null,
          },
          started
        );
        return NextResponse.json({
          ok: true,
          sent: 0,
          message: `今日（${observability.taipei_date}）提醒已執行過，略過重送`,
          prior_run_id: prior.id,
          ...observability,
        });
      }
    }

    const branches = (await fetchBranches()) as BranchRow[];
    const activeBranches = branches.filter((b) => b.line_group_id);
    const useLegacyMode = activeBranches.length === 0;
    const allRows = (await fetchReservationsForReminder(force)) as Record<string, unknown>[];
    let totalSent = 0;
    let line_rejected = 0;
    let heartbeat: ReminderHeartbeat = "none";
    let skipped_count = 0;

    if (useLegacyMode) {
      if (!isLineConfigured()) {
        const observability = finalizeObs(
          {
            ...base,
            reservation_count: allRows.length,
            sent_count: 0,
            skipped_count: 0,
            guest_sent_count: 0,
            result: "error",
            heartbeat: "none",
            duplicate: false,
            error: "未設定 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_GROUP_ID",
          },
          started
        );
        return NextResponse.json({ ok: false, ...observability }, { status: 503 });
      }

      if (allRows.length === 0) {
        if (sendHeartbeatOnEmpty) {
          const allTomorrow = await fetchTomorrowsReservations();
          const tomorrowCount = (allTomorrow ?? []).length;
          skipped_count = tomorrowCount;
          if (tomorrowCount === 0) {
            await sendLineMessage(emptyCatMessage());
            heartbeat = "cat";
          } else {
            await pushTextToGroups(
              alreadyNotifiedCronMessage(tomorrowCount, started),
              activeBranches,
              true
            );
            heartbeat = "already_notified";
          }
        }
        const result =
          heartbeat === "cat"
            ? "empty_cat"
            : heartbeat === "already_notified"
              ? "already_notified"
              : "already_notified";
        const heartbeatSent = heartbeat === "cat" || heartbeat === "already_notified" ? 1 : 0;
        const observability = finalizeObs(
          {
            ...base,
            reservation_count: skipped_count,
            sent_count: heartbeatSent,
            skipped_count,
            guest_sent_count: 0,
            result,
            heartbeat: heartbeat === "none" ? "already_notified" : heartbeat,
            duplicate: false,
          },
          started
        );
        return NextResponse.json({
          ok: true,
          sent: heartbeatSent,
          message_count: heartbeatSent,
          message: "沒有尚未通知的明日訂位（可能已全部發送過）",
          ...observability,
        });
      }

      const result = await pushDigestToGroup(allRows, null, "📅 明日訂位提醒");
      totalSent = result.sent;
      line_rejected += result.errors;
      heartbeat = result.sent > 0 ? "digest" : "none";
    } else {
      const matchedIds = new Set<string>();
      const allTomorrow = sendHeartbeatOnEmpty ? await fetchTomorrowsReservations() : null;

      for (const branch of activeBranches) {
        const groupId = branch.line_group_id!;
        const branchRows = allRows.filter((r) =>
          reservationMatchesBranch(r as ReminderReservationShape, branch)
        );

        if (branchRows.length === 0) {
          if (sendHeartbeatOnEmpty && allTomorrow) {
            const branchTomorrow = allTomorrow.filter((r: Record<string, unknown>) =>
              reservationMatchesBranch(r as ReminderReservationShape, branch)
            );
            if (branchTomorrow.length === 0) {
              await sendLineMessageToGroup(emptyCatMessage(), groupId).catch((e) =>
                console.error(`[send-line] cat msg failed for branch ${branch.name}:`, e)
              );
              heartbeat = heartbeat === "digest" ? "digest" : "cat";
            } else {
              skipped_count += branchTomorrow.length;
              await sendLineMessageToGroup(
                alreadyNotifiedCronMessage(branchTomorrow.length, started),
                groupId
              ).catch((e) =>
                console.error(`[send-line] status msg failed for branch ${branch.name}:`, e)
              );
              if (heartbeat !== "digest") heartbeat = "already_notified";
            }
          }
          continue;
        }

        const result = await pushDigestToGroup(branchRows, groupId, "📅 明日訂位提醒");
        for (const r of result.handled) matchedIds.add(r.id as string);
        totalSent += result.sent;
        line_rejected += result.errors;
        heartbeat = result.sent > 0 ? "digest" : heartbeat;
      }

      const unmatched = allRows.filter((r) => !matchedIds.has(r.id as string));
      if (unmatched.length > 0) {
        if (isLineConfigured()) {
          const result = await pushDigestToGroup(unmatched, null, "📅 明日訂位提醒（未設定分店群組）");
          totalSent += result.sent;
          line_rejected += result.errors;
          heartbeat = result.sent > 0 ? "digest" : heartbeat;
          console.warn(
            `[send-line] multi-branch: ${unmatched.length} row(s) fell back to LINE_GROUP_ID`
          );
        } else {
          console.error(
            `[send-line] multi-branch: ${unmatched.length} pending tomorrow reservation(s) matched no line_group_id and LINE_GROUP_ID unset`
          );
        }
      }
    }

    // Guest reminders are batched per recipient. The separate marker prevents
    // a group-only success from suppressing a guest retry after a LINE failure.
    let guest_sent_count = 0;
    let guest_rejected = 0;
    const guestRows = allRows.filter(
      (row) => row.line_user_id && !row.d1_guest_reminder_sent_at
    );
    const guestByUser = new Map<string, Record<string, unknown>[]>();
    for (const row of guestRows) {
      const userId = String(row.line_user_id);
      const rows = guestByUser.get(userId) ?? [];
      rows.push(row);
      guestByUser.set(userId, rows);
    }
    for (const [lineUserId, rows] of guestByUser) {
      for (let offset = 0; offset < rows.length; offset += REMINDER_DIGEST_CAROUSEL_MAX) {
        const rowChunk = rows.slice(offset, offset + REMINDER_DIGEST_CAROUSEL_MAX);
        const claims = await claimRows(
          rowChunk,
          "d1_guest",
          reminderDate(rowChunk[0]!),
          "guest",
          lineUserId
        );
        if (claims.toSend.length === 0) continue;
        const claimed = claims.toSend;
        let accepted = false;
        try {
          const flexRows = claimed.map(({ row }) => {
            const room = row.room as { name?: string; branch?: { name?: string } } | undefined;
            const reservationId = String(row.id);
            return {
              leadLabel: "明日",
              branchName: room?.branch?.name ?? "昇昇咖啡",
              roomName: room?.name ?? null,
              startTime: String(row.start_time),
              endTime: String(row.end_time),
              bookingCode: (row.booking_code as string | null) ?? null,
              confirmAttendanceUrl: `${LINE_SITE_URL}/book/confirm-visit?token=${encodeURIComponent(signAttendanceToken(reservationId))}`,
            };
          });
          const [flex] = buildGuestReminderDigestFlexChunks(flexRows);
          const part = rows.length > REMINDER_DIGEST_CAROUSEL_MAX
            ? `（${Math.floor(offset / REMINDER_DIGEST_CAROUSEL_MAX) + 1}/${Math.ceil(rows.length / REMINDER_DIGEST_CAROUSEL_MAX)}）`
            : "";
          await sendLineFlexMessage(lineUserId, `明日訂位提醒${part}`, flex!);
          accepted = true;
          guest_sent_count += 1;
          await settleClaims(claimed, "sent");
          await Promise.all(
            claimed.map(({ row }) =>
              updateReservationAdmin(String(row.id), {
                d1_guest_reminder_sent_at: new Date().toISOString(),
              })
            )
          );
        } catch (error) {
          guest_rejected += 1;
          await settleClaims(claimed, accepted ? "sent" : "failed", error);
          console.error(`[send-line] 客人摘要傳送失敗: ${safeLineDeliveryError(error)}`);
        }
      }
    }

    const totalRejected = line_rejected + guest_rejected;
    const heartbeatSent = heartbeat === "cat" || heartbeat === "already_notified" ? 1 : 0;
    const totalMessages = totalSent + guest_sent_count + heartbeatSent;
    const result: ReminderRunObservability["result"] =
      totalRejected > 0 && totalSent + guest_sent_count > 0
        ? "partial"
        : totalRejected > 0
          ? "error"
          : totalSent > 0 || guest_sent_count > 0
          ? "sent"
          : heartbeat === "cat"
            ? "empty_cat"
            : "already_notified";

    const observability = finalizeObs(
      {
        ...base,
        reservation_count: allRows.length + skipped_count,
        sent_count: totalMessages,
        skipped_count: skipped_count + (allRows.length === 0 ? 0 : 0),
        guest_sent_count,
        result,
        heartbeat,
        duplicate: false,
        accepted_count:
          totalMessages,
        rejected_count: totalRejected,
      },
      started
    );

    // reservation_count should reflect tomorrow active set when we know it
    if (allRows.length > 0) {
      observability.reservation_count = allRows.length;
      observability.skipped_count = 0;
    }

    return NextResponse.json({
      ok: totalRejected === 0,
      sent: totalMessages,
      message_count: totalMessages,
      errors: line_rejected + guest_rejected,
      message:
        totalMessages === 0
          ? "沒有尚未通知的明日訂位（可能已全部發送過）"
          : `已發送 ${totalMessages} 則 LINE 訊息（LINE accepted≠delivered）`,
      ...observability,
    });
  } catch (err) {
    const message = errorToDetail(err);
    console.error("[send-line] Error:", message);
    const observability = finalizeObs(
      {
        ...base,
        reservation_count: 0,
        sent_count: 0,
        skipped_count: 0,
        guest_sent_count: 0,
        result: "error",
        heartbeat: "none",
        duplicate: false,
        error: message,
        accepted_count: 0,
        rejected_count: 1,
      },
      started
    );
    return NextResponse.json({ ok: false, ...observability }, { status: 500 });
  }
}
