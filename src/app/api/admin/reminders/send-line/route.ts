import { NextRequest } from "next/server";
import { runCronJob } from "@/lib/job-runs";
import { authorizeCronGet } from "@/lib/cron-request-auth";
import { runSendLineReminder } from "@/lib/send-line-reminder";
import { resolveReminderTriggerSource } from "@/lib/reminder-trigger-source";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronGet(request);
  if (!cronAuth.ok) return cronAuth.response;
  const trigger_source = resolveReminderTriggerSource(request, "GET");
  return runCronJob(
    "send-line",
    () =>
      runSendLineReminder({
        force: false,
        sendHeartbeatOnEmpty: true,
        enforceDayIdempotency: true,
        trigger_source,
      }),
    { trigger_source }
  );
}

export async function POST(request: NextRequest) {
  const trigger_source = resolveReminderTriggerSource(request, "POST");
  // Manual: never day-lock (staff may intentionally re-check); still no re-send of is_notified rows
  return runCronJob(
    "send-line",
    () =>
      runSendLineReminder({
        force: false,
        sendHeartbeatOnEmpty: false,
        enforceDayIdempotency: false,
        trigger_source,
      }),
    { trigger_source }
  );
}
