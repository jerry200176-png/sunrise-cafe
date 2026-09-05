import { NextRequest } from "next/server";
import { isVercelCronRequest } from "@/lib/cron-request-auth";
import type { ReminderTriggerSource } from "@/lib/job-runs";

export function resolveReminderTriggerSource(
  request: NextRequest,
  method: "GET" | "POST"
): ReminderTriggerSource {
  if (method === "POST") return "manual";
  const header = request.headers.get("x-reminder-trigger")?.toLowerCase();
  if (header === "github") return "github";
  if (isVercelCronRequest(request)) return "cron";
  return "cron";
}
