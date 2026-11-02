import { NextRequest, NextResponse } from "next/server";
import {
  fetchUnpaidDepositDueReservations,
  updateReservationAdmin,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { sendLineFlexMessage } from "@/lib/line";
import {
  buildGuestDepositReminderFlex,
} from "@/lib/line-cards";
import {
  computeDepositDeadline,
  formatDepositDeadlineLabel,
  getDepositUrgency,
  shouldAutoRelease,
  shouldSendDepositReminder,
  shouldSendUrgentDepositReminder,
} from "@/lib/deposit-deadline";
import { toTaipei, taipeiDateString } from "@/lib/datetime";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { logPayment } from "@/lib/payment-log";
import { errorToDetail } from "@/lib/cron-alert";
import { runCronJob } from "@/lib/job-runs";
import { authorizeCronGet } from "@/lib/cron-request-auth";
import { runBootstrapMigrations } from "@/lib/bootstrap-migrations";
import {
  claimLineReminderDelivery,
  markLineReminderDelivery,
  safeLineDeliveryError,
} from "@/lib/line-delivery";

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
    }),
    { reservationId: r.id }
  );
}

async function handleRun() {
  await runBootstrapMigrations();
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  try {
  const now = new Date();
  // Overdue unpaid reservations remain active; old auto-cancel flags cannot change this policy.
  const rows = (await fetchUnpaidDepositDueReservations(
    { startAfter: now.toISOString() }
  )) as unknown as Row[];
  const released = 0;
  let deadlinePassed = 0;
  let reminded = 0;
  let urgentReminded = 0;
  let errors = 0;
  let messageCount = 0;
  // Historical failed release notices are retained, but are not retried here:
  // the reservation may have been restored since the original cancellation.
  logPayment("deposit_deadline.cron_run", { candidate_count: rows.length, auto_cancel_enabled: false });

  for (const r of rows) {
    const deadline = computeDepositDeadline(r.created_at, r.start_time);

    if (shouldAutoRelease(deadline, now)) {
      deadlinePassed++;
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

  return NextResponse.json({
    ok: errors === 0,
    sent: messageCount,
    message_count: messageCount,
    accepted_count: messageCount,
    rejected_count: errors,
    auto_cancel_enabled: false,
    released,
    deadline_passed: deadlinePassed,
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
