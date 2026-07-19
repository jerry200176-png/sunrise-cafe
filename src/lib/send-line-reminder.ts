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
import { sendLineFlexMessage, buildReminderFlex } from "@/lib/line";
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

async function pushDigestToGroup(
  rows: Record<string, unknown>[],
  groupId: string | null,
  labelPrefix: string
) {
  const enriched = rows.map(toEnriched);
  const chunks = buildReminderDigestFlexChunks(enriched);
  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1 ? `（${i + 1}/${chunks.length}）` : "";
    const alt = `${labelPrefix}，共 ${rows.length} 筆${part}`;
    if (groupId) {
      await sendLineFlexToGroup(alt, chunks[i]!, groupId);
    } else {
      await sendLineFlex(alt, chunks[i]!);
    }
  }
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
        const observability = finalizeObs(
          {
            ...base,
            reservation_count: skipped_count,
            sent_count: 0,
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
          sent: 0,
          message: "沒有尚未通知的明日訂位（可能已全部發送過）",
          ...observability,
        });
      }

      await pushDigestToGroup(allRows, null, "📅 明日訂位提醒");
      await Promise.all(allRows.map((r) => updateReservationAdmin(r.id as string, { is_notified: true })));
      totalSent = allRows.length;
      heartbeat = "digest";
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

        await pushDigestToGroup(branchRows, groupId, "📅 明日訂位提醒");
        await Promise.all(
          branchRows.map((r) => updateReservationAdmin(r.id as string, { is_notified: true }))
        );
        for (const r of branchRows) matchedIds.add(r.id as string);
        totalSent += branchRows.length;
        heartbeat = "digest";
      }

      const unmatched = allRows.filter((r) => !matchedIds.has(r.id as string));
      if (unmatched.length > 0) {
        if (isLineConfigured()) {
          await pushDigestToGroup(unmatched, null, "📅 明日訂位提醒（未設定分店群組）");
          await Promise.all(
            unmatched.map((r) => updateReservationAdmin(r.id as string, { is_notified: true }))
          );
          totalSent += unmatched.length;
          heartbeat = "digest";
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

    // Guest personal reminders (only pending rows — idempotent via is_notified)
    let guest_sent_count = 0;
    let guest_rejected = 0;
    for (const r of allRows) {
      const lineUserId = r.line_user_id as string | null;
      if (!lineUserId) continue;
      try {
        const room = r.room as { name?: string; branch?: { name?: string } } | undefined;
        const reservationId = r.id as string;
        const bookingCode = (r.booking_code as string | null) ?? null;
        const confirmAttendanceUrl = reservationId
          ? `${LINE_SITE_URL}/book/confirm-visit?token=${encodeURIComponent(signAttendanceToken(reservationId))}`
          : null;
        const flex = buildReminderFlex({
          leadLabel: "明日",
          branchName: room?.branch?.name ?? "昇昇咖啡",
          roomName: room?.name ?? null,
          startTime: r.start_time as string,
          endTime: r.end_time as string,
          bookingCode,
          confirmAttendanceUrl,
        });
        await sendLineFlexMessage(lineUserId, "明日訂位提醒", flex);
        guest_sent_count += 1;
      } catch {
        guest_rejected += 1;
      }
    }

    const result: ReminderRunObservability["result"] =
      guest_rejected > 0 && totalSent + guest_sent_count > 0
        ? "partial"
        : totalSent > 0 || guest_sent_count > 0
          ? "sent"
          : heartbeat === "cat"
            ? "empty_cat"
            : "already_notified";

    const observability = finalizeObs(
      {
        ...base,
        reservation_count: allRows.length + skipped_count,
        sent_count: totalSent,
        skipped_count: skipped_count + (allRows.length === 0 ? 0 : 0),
        guest_sent_count,
        result,
        heartbeat,
        duplicate: false,
        accepted_count:
          totalSent +
          guest_sent_count +
          (heartbeat === "cat" || heartbeat === "already_notified" ? 1 : 0),
        rejected_count: guest_rejected,
      },
      started
    );

    // reservation_count should reflect tomorrow active set when we know it
    if (allRows.length > 0) {
      observability.reservation_count = allRows.length;
      observability.skipped_count = 0;
    }

    return NextResponse.json({
      ok: guest_rejected === 0,
      sent: totalSent,
      errors: guest_rejected,
      message:
        totalSent === 0
          ? "沒有尚未通知的明日訂位（可能已全部發送過）"
          : `已發送 ${totalSent} 筆明日提醒（LINE accepted≠delivered）`,
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
