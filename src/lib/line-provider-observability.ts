import { logOps } from "@/lib/ops-log";

/** Record provider rejection without logging access tokens, user IDs, or payloads. */
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
  console.error("[line] provider rejection", detail);
  logOps("line", "line.provider_rejected", detail);
}
