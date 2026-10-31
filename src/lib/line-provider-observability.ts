import { logOps } from "@/lib/ops-log";
import { lineHttpFailure } from "@/lib/line-send-error";

/** Record provider errors without guessing acceptance or logging recipient data. */
export function observeLineProviderRejection(input: {
  channel: "group" | "customer" | "reply";
  operation: "push" | "reply";
  status: number;
  retryKey?: string;
}): void {
  const detail = {
    channel: input.channel,
    operation: input.operation,
    provider_status: input.status,
    retry_key_present: Boolean(input.retryKey),
    escalation: "caller_and_cron_failure_path",
  };
  const unknown = lineHttpFailure(input.status) === "unknown";
  console.error(unknown ? "[line] provider outcome unknown" : "[line] provider rejection", detail);
  logOps("line", unknown ? "line.provider_unknown" : "line.provider_rejected", detail);
}
