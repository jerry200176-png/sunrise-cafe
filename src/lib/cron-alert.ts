/**
 * Cron job failure alerting — push to LINE group when scheduled jobs fail.
 */
import { isLineConfigured, sendLineMessage } from "@/lib/line-notify";

/** Serialize any thrown value for logs and LINE (PostgREST errors are plain objects). */
export function errorToDetail(error: unknown): string {
  if (error == null) return "Unknown error";
  if (error instanceof Error) return error.message || error.name || "Error";
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean") return String(error);

  if (typeof error === "object") {
    const o = error as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) {
      const code = typeof o.code === "string" ? ` [${o.code}]` : "";
      const details = typeof o.details === "string" && o.details ? ` — ${o.details}` : "";
      return `${o.message}${code}${details}`;
    }
    if (typeof o.error === "string" && o.error.trim()) return o.error;
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") {
        return json.length > 400 ? `${json.slice(0, 400)}…` : json;
      }
    } catch {
      /* fall through */
    }
  }

  return String(error);
}

export function formatCronAlert(jobName: string, error: unknown): string {
  const detail = errorToDetail(error);
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
