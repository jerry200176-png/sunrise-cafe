/**
 * Cron job failure alerting — push to LINE group when scheduled jobs fail.
 */
import { isLineConfigured, sendLineMessage } from "@/lib/line-notify";

export function formatCronAlert(jobName: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const truncated = detail.length > 400 ? `${detail.slice(0, 400)}…` : detail;
  return `🚨【Cron 失敗】${jobName}\n${truncated}\n時間：${new Date().toISOString()}`;
}

/** Best-effort LINE alert; never throws. */
export async function notifyCronFailure(jobName: string, error: unknown): Promise<void> {
  console.error(`[cron-alert] ${jobName}:`, error);
  if (!isLineConfigured()) return;
  try {
    await sendLineMessage(formatCronAlert(jobName, error));
  } catch (notifyErr) {
    console.error("[cron-alert] LINE notify failed:", notifyErr);
  }
}
