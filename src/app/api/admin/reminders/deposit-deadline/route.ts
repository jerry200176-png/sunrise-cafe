import { NextRequest, NextResponse } from "next/server";
import {
  fetchUnpaidDepositDueReservations,
  updateReservationAdmin,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { sendLineFlexMessage } from "@/lib/line";
import {
  buildGuestDepositReminderFlex,
  buildGuestDepositReleasedFlex,
} from "@/lib/line-cards";
import { sendLineFlex, buildDepositReleasedGroupFlex } from "@/lib/line-notify";
import {
  computeDepositDeadline,
  formatDepositDeadlineLabel,
  getDepositUrgency,
  shouldAutoRelease,
  shouldSendDepositReminder,
  shouldSendUrgentDepositReminder,
} from "@/lib/deposit-deadline";
import { notifyWaitlist } from "@/lib/waitlist";
import { toTaipei } from "@/lib/datetime";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { logPayment, logDepositStatusChange } from "@/lib/payment-log";
import { errorToDetail } from "@/lib/cron-alert";
import { runCronJob } from "@/lib/job-runs";
import { authorizeCronGet } from "@/lib/cron-request-auth";

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

async function handleRun() {
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

  logPayment("deposit_deadline.cron_run", { candidate_count: rows.length });

  for (const r of rows) {
    const deadline = computeDepositDeadline(r.created_at, r.start_time);
    const { branchName } = describe(r);

    if (shouldAutoRelease(deadline, now)) {
      try {
        await updateReservationAdmin(r.id, { status: "cancelled" });

        if (r.line_user_id) {
          await sendLineFlexMessage(
            r.line_user_id,
            "訂位已釋放",
            buildGuestDepositReleasedFlex({
              branchName,
              bookingCode: r.booking_code,
              startTime: r.start_time,
              endTime: r.end_time,
            })
          ).catch((err) => console.error("[deposit-deadline] 客人通知失敗:", err));
        }

        await sendLineFlex(
          `訂金逾期釋放：${r.customer_name}`,
          buildDepositReleasedGroupFlex({
            customerName: r.customer_name,
            phone: r.phone,
            bookingCode: r.booking_code,
            startTime: r.start_time,
            endTime: r.end_time,
          })
        ).catch((err) => console.error("[deposit-deadline] 群組通知失敗:", err));

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
      try {
        const urgency = getDepositUrgency(deadline, now) === "soon" ? "soon" : "ok";
        await sendDepositReminder(r, urgency);
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
        console.error(`[deposit-deadline] 提醒失敗 id=${r.id}:`, err);
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
      try {
        await sendDepositReminder(r, "soon");
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
          console.error(`[deposit-deadline] 迫近提醒失敗 id=${r.id}:`, err);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, released, reminded, urgentReminded, errors });
  } catch (err) {
    return NextResponse.json({ error: errorToDetail(err) }, { status: 500 });
  }
}

/** GET: Vercel Cron 觸發 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronGet(request);
  if (!cronAuth.ok) return cronAuth.response;
  return runCronJob("deposit-deadline", () => handleRun());
}

/** POST: 手動觸發 */
export async function POST() {
  return runCronJob("deposit-deadline", () => handleRun());
}
