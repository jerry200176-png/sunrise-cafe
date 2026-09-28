import { NextRequest, NextResponse } from "next/server";
import {
  fetchUnpaidDepositDueReservations,
  fetchFailedDepositReleaseGroupDeliveries,
  updateReservationAdmin,
  isAdminConfigured,
  supabaseAdmin,
} from "@/lib/supabase-admin";
import { sendLineFlexMessage } from "@/lib/line";
import {
  buildGuestDepositReminderFlex,
  buildGuestDepositReleasedFlex,
} from "@/lib/line-cards";
import {
  sendLineFlexBatch,
  sendLineFlexBatchToGroup,
  buildDepositReleasedGroupFlex,
  type LineFlexMessage,
  type LineSendOptions,
} from "@/lib/line-notify";
import { branchLineGroupIdForReservation } from "@/lib/branch-line-group";
import {
  computeDepositDeadline,
  formatDepositDeadlineLabel,
  getDepositUrgency,
  shouldAutoRelease,
  shouldSendDepositReminder,
  shouldSendUrgentDepositReminder,
} from "@/lib/deposit-deadline";
import { notifyWaitlist } from "@/lib/waitlist";
import { toTaipei, taipeiDateString } from "@/lib/datetime";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { logPayment, logDepositStatusChange } from "@/lib/payment-log";
import { errorToDetail } from "@/lib/cron-alert";
import { runCronJob } from "@/lib/job-runs";
import { authorizeCronGet } from "@/lib/cron-request-auth";
import { runBootstrapMigrations } from "@/lib/bootstrap-migrations";
import {
  claimLineReminderDelivery,
  claimFailedLineReminderDelivery,
  markLineReminderDelivery,
  safeLineDeliveryError,
} from "@/lib/line-delivery";
import { cancelReservationPreorder } from "@/lib/reservation-preorder";

type Row = {
  id: string;
  booking_code: string;
  customer_name: string;
  phone: string;
  start_time: string;
  end_time: string;
  created_at: string;
  status: string;
  line_user_id: string | null;
  deposit_reminder_sent_at: string | null;
  deposit_urgent_reminder_sent_at?: string | null;
  room: { id: string; name: string; branch?: { name?: string } } | null;
};

function describe(r: Row) {
  const startDate = toTaipei(r.start_time);
  const endDate = toTaipei(r.end_time);
  const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
  const branchName = r.room?.branch?.name ?? "昇昇咖啡";
  return { formattedDate, timeRange, branchName };
}

async function sendDepositReminder(r: Row, urgency: "ok" | "soon") {
  const { branchName } = describe(r);
  const deadline = computeDepositDeadline(r.created_at, r.start_time);
  const deadlineLabel = formatDepositDeadlineLabel(deadline);
  await sendLineFlexMessage(
    r.line_user_id!,
    urgency === "soon" ? "訂金即將逾期" : "訂金提醒",
    buildGuestDepositReminderFlex({
      branchName,
      bookingCode: r.booking_code,
      startTime: r.start_time,
      endTime: r.end_time,
      urgency,
      deadlineLabel,
    })
  );
}

function buildGroupReleaseNotice(r: Row) {
  return {
    altText: `訂金逾期釋放：${r.customer_name}`,
    contents: buildDepositReleasedGroupFlex({
      customerName: r.customer_name,
      phone: r.phone,
      bookingCode: r.booking_code,
      startTime: r.start_time,
      endTime: r.end_time,
    }),
  };
}

async function handleRun() {
  await runBootstrapMigrations();
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  try {
  const rows = (await fetchUnpaidDepositDueReservations()) as unknown as Row[];
  const now = new Date();
  let released = 0;
  let reminded = 0;
  let urgentReminded = 0;
  let errors = 0;
  let messageCount = 0;
  const pendingGroupReleases: {
    deliveryId: string | null;
    groupId: string | null;
    altText: string;
    contents: Record<string, unknown>;
  }[] = [];

  // Cancelled reservations are intentionally absent from the normal unpaid
  // query. Recover only failed staff release alerts, with a CAS claim so two
  // overlapping cron runs cannot resend the same delivery.
  try {
    const failedReleases = await fetchFailedDepositReleaseGroupDeliveries();
    for (const failed of failedReleases) {
      const claimed = await claimFailedLineReminderDelivery(failed.delivery_id);
      if (!claimed) continue;
      const notice = buildGroupReleaseNotice(failed.reservation as unknown as Row);
      const groupId = await branchLineGroupIdForReservation(supabaseAdmin(), (failed.reservation as unknown as Row).id);
      pendingGroupReleases.push({ deliveryId: failed.delivery_id, groupId, ...notice });
    }
  } catch (err) {
    errors++;
    console.error("[deposit-deadline] failed group release recovery unavailable:", safeLineDeliveryError(err));
  }

  logPayment("deposit_deadline.cron_run", { candidate_count: rows.length });

  for (const r of rows) {
    const deadline = computeDepositDeadline(r.created_at, r.start_time);
    const { branchName } = describe(r);

    if (shouldAutoRelease(deadline, now)) {
      try {
        const guestClaim = r.line_user_id
          ? await claimLineReminderDelivery({
              reminderType: "deposit_release_guest",
              reminderDate: taipeiDateString(new Date(r.start_time)),
              reservationId: r.id,
              recipientType: "guest",
              recipientId: r.line_user_id,
            })
          : null;
        const groupClaim = await claimLineReminderDelivery({
          reminderType: "deposit_release_group",
          reminderDate: taipeiDateString(new Date(r.start_time)),
          reservationId: r.id,
          recipientType: "group",
          recipientId: "legacy-group",
        });
        if (
          groupClaim.available &&
          !groupClaim.id &&
          (guestClaim === null || (guestClaim.available && !guestClaim.id))
        ) {
          // Another run claimed this release, or the reservation became paid/
          // inactive between the candidate query and this atomic claim.
          continue;
        }
        await updateReservationAdmin(r.id, { status: "cancelled" });
        await cancelReservationPreorder(r.id, "deposit_deadline_auto_cancel");

        if (r.line_user_id && (!guestClaim?.available || guestClaim.id)) {
          try {
            await sendLineFlexMessage(
              r.line_user_id,
              "訂位已釋放",
              buildGuestDepositReleasedFlex({
                branchName,
                bookingCode: r.booking_code,
                startTime: r.start_time,
                endTime: r.end_time,
              })
            );
            messageCount++;
            if (guestClaim?.id) await markLineReminderDelivery(guestClaim.id, { status: "sent" });
          } catch (err) {
            errors++;
            if (guestClaim?.id) {
              await markLineReminderDelivery(guestClaim.id, {
                status: "failed",
                error: safeLineDeliveryError(err),
              });
            }
            console.error("[deposit-deadline] 客人通知失敗:", safeLineDeliveryError(err));
          }
        }

        if (!groupClaim.available || groupClaim.id) {
          const groupId = await branchLineGroupIdForReservation(supabaseAdmin(), r.id);
          pendingGroupReleases.push({ deliveryId: groupClaim.id, groupId, ...buildGroupReleaseNotice(r) });
        }

        notifyWaitlist(r.room?.id ?? "", r.start_time, r.end_time).catch((err) =>
          console.error("[deposit-deadline] waitlist notify failed:", err)
        );

        released++;
        logPayment("deposit_deadline.released", {
          reservation_id: r.id,
          booking_code: r.booking_code,
        });
        logDepositStatusChange({
          action: "deposit.auto_released",
          reservation_id: r.id,
          booking_code: r.booking_code,
          actor_type: "cron_deposit_deadline",
          before: { is_deposit_paid: false, status: r.status },
          after: { is_deposit_paid: false, status: "cancelled" },
        });
      } catch (err) {
        errors++;
        console.error(`[deposit-deadline] 釋放失敗 id=${r.id}:`, err);
      }
      continue;
    }

    if (!r.line_user_id) continue;

    if (shouldSendDepositReminder(deadline, r.deposit_reminder_sent_at, now)) {
      let deliveryId: string | null = null;
      let lineAccepted = false;
      try {
        const claim = await claimLineReminderDelivery({
          reminderType: "deposit_initial",
          reminderDate: taipeiDateString(new Date(r.start_time)),
          reservationId: r.id,
          recipientType: "guest",
          recipientId: r.line_user_id,
        });
        if (claim.available && !claim.id) continue;
        deliveryId = claim.id;
        const urgency = getDepositUrgency(deadline, now) === "soon" ? "soon" : "ok";
        await sendDepositReminder(r, urgency);
        lineAccepted = true;
        messageCount++;
        if (deliveryId) await markLineReminderDelivery(deliveryId, { status: "sent" });
        const stamp = now.toISOString();
        await updateReservationAdmin(r.id, {
          deposit_reminder_sent_at: stamp,
          ...(urgency === "soon" ? { deposit_urgent_reminder_sent_at: stamp } : {}),
        });
        reminded++;
        if (urgency === "soon") urgentReminded++;
        logPayment("deposit_deadline.reminded", {
          reservation_id: r.id,
          booking_code: r.booking_code,
          urgency,
        });
      } catch (err) {
        errors++;
        if (deliveryId && !lineAccepted) {
          await markLineReminderDelivery(deliveryId, {
            status: "failed",
            error: safeLineDeliveryError(err),
          });
        }
        console.error(`[deposit-deadline] 提醒失敗 id=${r.id}:`, safeLineDeliveryError(err));
      }
      continue;
    }

    if (
      shouldSendUrgentDepositReminder(
        deadline,
        r.deposit_reminder_sent_at,
        r.deposit_urgent_reminder_sent_at,
        now
      )
    ) {
      let deliveryId: string | null = null;
      let lineAccepted = false;
      try {
        const claim = await claimLineReminderDelivery({
          reminderType: "deposit_urgent",
          reminderDate: taipeiDateString(new Date(r.start_time)),
          reservationId: r.id,
          recipientType: "guest",
          recipientId: r.line_user_id,
        });
        if (claim.available && !claim.id) continue;
        deliveryId = claim.id;
        await sendDepositReminder(r, "soon");
        lineAccepted = true;
        messageCount++;
        if (deliveryId) await markLineReminderDelivery(deliveryId, { status: "sent" });
        await updateReservationAdmin(r.id, {
          deposit_urgent_reminder_sent_at: now.toISOString(),
        });
        urgentReminded++;
        logPayment("deposit_deadline.urgent_reminded", {
          reservation_id: r.id,
          booking_code: r.booking_code,
        });
      } catch (err) {
        // Column missing → degrade silently (first reminder already covers)
        if (
          err instanceof Error &&
          /deposit_urgent_reminder_sent_at/i.test(err.message)
        ) {
          console.warn("[deposit-deadline] urgent column missing; skip stamp:", err.message);
        } else {
          errors++;
          if (deliveryId && !lineAccepted) {
            await markLineReminderDelivery(deliveryId, {
              status: "failed",
              error: safeLineDeliveryError(err),
            });
          }
          console.error(`[deposit-deadline] 迫近提醒失敗 id=${r.id}:`, safeLineDeliveryError(err));
        }
      }
    }
  }

  // A release cron can process several reservations at once. Keep each
  // reservation as its own actionable Flex card, but send up to five cards in
  // one push request so LINE counts the group recipient once per batch rather
  // than once per reservation. Delivery ledger claims remain per reservation.
  // Each branch's releases go to that branch's group (default group when unset).
  const sendBatch = (groupId: string | null, messages: LineFlexMessage[], options: LineSendOptions) =>
    groupId ? sendLineFlexBatchToGroup(messages, groupId, options) : sendLineFlexBatch(messages, options);
  const releasesByGroup = new Map<string | null, typeof pendingGroupReleases>();
  for (const release of pendingGroupReleases) {
    releasesByGroup.set(release.groupId, [...(releasesByGroup.get(release.groupId) ?? []), release]);
  }
  const batches = [...releasesByGroup.values()].flatMap((releases) =>
    Array.from({ length: Math.ceil(releases.length / 5) }, (_, i) => releases.slice(i * 5, i * 5 + 5))
  );
  for (const batch of batches) {
    const groupId = batch[0].groupId;
    const retryKey = crypto.randomUUID();
    try {
      await sendBatch(
        groupId,
        batch.map(({ altText, contents }) => ({ altText, contents })),
        { retryKey },
      );
      await Promise.all(
        batch
          .filter(({ deliveryId }) => deliveryId)
          .map(({ deliveryId }) => markLineReminderDelivery(deliveryId!, { status: "sent" }))
      );
      messageCount++;
    } catch {
      // Reuse the same provider retry key once. A timeout/5xx may have been
      // accepted by LINE; a second request with the same key becomes a 409
      // reconciliation instead of a duplicate push.
      try {
        await sendBatch(
          groupId,
          batch.map(({ altText, contents }) => ({ altText, contents })),
          { retryKey },
        );
        await Promise.all(
          batch
            .filter(({ deliveryId }) => deliveryId)
            .map(({ deliveryId }) => markLineReminderDelivery(deliveryId!, { status: "sent" }))
        );
        messageCount++;
      } catch (retryError) {
        errors++;
        await Promise.all(
          batch
            .filter(({ deliveryId }) => deliveryId)
            .map(({ deliveryId }) =>
              markLineReminderDelivery(deliveryId!, {
                status: "failed",
                error: safeLineDeliveryError(retryError),
              })
            )
        );
        console.error("[deposit-deadline] 群組通知批次失敗:", safeLineDeliveryError(retryError));
      }
    }
  }

  return NextResponse.json({
    ok: errors === 0,
    sent: messageCount,
    message_count: messageCount,
    accepted_count: messageCount,
    rejected_count: errors,
    released,
    reminded,
    urgentReminded,
    errors,
  });
  } catch (err) {
    return NextResponse.json({ error: errorToDetail(err) }, { status: 500 });
  }
}

/** GET: Vercel Cron 觸發 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronGet(request);
  if (!cronAuth.ok) return cronAuth.response;
  await runBootstrapMigrations();
  return runCronJob("deposit-deadline", () => handleRun());
}

/** POST: 手動觸發 */
export async function POST() {
  await runBootstrapMigrations();
  return runCronJob("deposit-deadline", () => handleRun());
}
