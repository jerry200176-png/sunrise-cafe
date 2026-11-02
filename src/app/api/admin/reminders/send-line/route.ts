import { NextRequest } from "next/server";
import { runCronJob } from "@/lib/job-runs";
import { authorizeCronGet } from "@/lib/cron-request-auth";
import { runSendLineReminder } from "@/lib/send-line-reminder";
import { resolveReminderTriggerSource } from "@/lib/reminder-trigger-source";
import { runBootstrapMigrations } from "@/lib/bootstrap-migrations";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronGet(request);
  if (!cronAuth.ok) return cronAuth.response;
  const trigger_source = resolveReminderTriggerSource(request, "GET");
  await runBootstrapMigrations();
  return runCronJob(
    "send-line",
    () =>
      runSendLineReminder({
        force: false,
        // Empty/already-notified heartbeats consume group recipients' LINE quota.
        // Keep actual reservation reminders and failure reporting; an empty run
        // is visible via job_runs and the reminder verification endpoint.
        sendHeartbeatOnEmpty: false,
        enforceDayIdempotency: true,
        trigger_source,
      }),
    { trigger_source }
  );
}

export async function POST(request: NextRequest) {
  const trigger_source = resolveReminderTriggerSource(request, "POST");
  await runBootstrapMigrations();
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
