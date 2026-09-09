import { fetchLineQuotaSnapshot } from "../src/lib/line-usage";
import { createClient } from "@supabase/supabase-js";

type UsageRow = {
  source: string;
  priority: "critical" | "actionable" | "informational";
  channel: "group" | "guest" | "reply";
  baseline: number;
  optimized: number;
  note: string;
};

// Dry-run fixture: 30 days, based on the current test scenarios and a
// conservative small-cafe operating month. It is deliberately not presented
// as production truth when no production credential is supplied.
const rows: UsageRow[] = [
  { source: "D-1 group digest", priority: "actionable", channel: "group", baseline: 30, optimized: 30, note: "existing one digest/day" },
  { source: "D-1 guest digest", priority: "actionable", channel: "guest", baseline: 75, optimized: 75, note: "existing per-recipient digest" },
  { source: "D-7 guest digest", priority: "informational", channel: "guest", baseline: 40, optimized: 40, note: "existing per-recipient digest" },
  { source: "deposit initial + urgent", priority: "actionable", channel: "guest", baseline: 45, optimized: 45, note: "preserved two-stage deadline reminder" },
  { source: "deposit release guest", priority: "critical", channel: "guest", baseline: 20, optimized: 20, note: "preserved per guest" },
  { source: "deposit release group", priority: "critical", channel: "group", baseline: 20, optimized: 4, note: "20 cards, max 5 Flex objects/request" },
  { source: "new booking group", priority: "actionable", channel: "group", baseline: 60, optimized: 60, note: "transactional staff alert" },
  { source: "payment review group", priority: "actionable", channel: "group", baseline: 15, optimized: 15, note: "preserved manual-review alert" },
  { source: "payment approved group + guest", priority: "critical", channel: "group", baseline: 25, optimized: 25, note: "provider retry/idempotency preserved" },
  { source: "payment approved guest", priority: "critical", channel: "guest", baseline: 25, optimized: 25, note: "provider retry/idempotency preserved" },
  { source: "cancel/reschedule/attendance guest", priority: "actionable", channel: "guest", baseline: 43, optimized: 43, note: "existing lifecycle dedupe preserved" },
  { source: "reschedule/attendance/waitlist group", priority: "actionable", channel: "group", baseline: 36, optimized: 36, note: "immediate staff action" },
  { source: "waitlist guest", priority: "actionable", channel: "guest", baseline: 6, optimized: 6, note: "confirmation window preserved" },
  { source: "review invite guest", priority: "informational", channel: "guest", baseline: 10, optimized: 10, note: "existing one-shot stamp" },
  { source: "empty/already-notified heartbeat", priority: "informational", channel: "group", baseline: 30, optimized: 15, note: "36h unchanged-state cooldown; heartbeat retained" },
  { source: "cron failure alert", priority: "critical", channel: "group", baseline: 1, optimized: 1, note: "failure handling preserved" },
  { source: "webhook replies", priority: "actionable", channel: "reply", baseline: 30, optimized: 30, note: "LINE reply messages are not quota-counted" },
];

function sum(items: UsageRow[], key: "baseline" | "optimized") {
  return items.reduce((total, row) => total + row[key], 0);
}

type ProductionSourceAudit = {
  available: boolean;
  window_start: string;
  window_end: string;
  job_runs?: {
    total: number;
    completed: number;
    failed: number;
    by_job: Record<string, {
      runs: number;
      completed: number;
      failed: number;
      items_processed: number;
      accepted_count: number;
      rejected_count: number;
      message_count: number;
      guest_sent_count: number;
      heartbeat_count: number;
    }>;
  };
  ops_events?: { total: number; by_action: Record<string, number> };
  reason?: string;
};

type JobRunBuckets = NonNullable<ProductionSourceAudit["job_runs"]>["by_job"];

function addNumber(target: Record<string, number>, key: string, value: unknown): void {
  const amount = Number(value);
  if (Number.isFinite(amount)) target[key] = (target[key] ?? 0) + amount;
}

/** Read-only source attribution from the durable application evidence tables. */
async function fetchProductionSourceAudit(days = 30): Promise<ProductionSourceAudit> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);
  const base = {
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
  };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.startsWith("<")) {
    return { available: false, ...base, reason: "Supabase read-only credentials unavailable" };
  }

  const db = createClient(url, key);
  const [jobRuns, opsEvents] = await Promise.all([
    db
      .from("job_runs")
      .select("job_name,status,items_processed,metadata")
      .gte("started_at", base.window_start)
      .lte("started_at", base.window_end)
      .limit(5000),
    db
      .from("ops_events")
      .select("action")
      .gte("created_at", base.window_start)
      .lte("created_at", base.window_end)
      .limit(5000),
  ]);
  if (jobRuns.error || opsEvents.error) {
    return {
      available: false,
      ...base,
      reason: "Production source tables unavailable or unreadable",
    };
  }

  const byJob: JobRunBuckets = {};
  let completed = 0;
  let failed = 0;
  for (const row of jobRuns.data ?? []) {
    const job = String(row.job_name ?? "unknown");
    const bucket = (byJob[job] ??= {
      runs: 0,
      completed: 0,
      failed: 0,
      items_processed: 0,
      accepted_count: 0,
      rejected_count: 0,
      message_count: 0,
      guest_sent_count: 0,
      heartbeat_count: 0,
    });
    bucket.runs++;
    bucket.items_processed += Number(row.items_processed ?? 0) || 0;
    if (row.status === "completed") {
      completed++;
      bucket.completed++;
    }
    if (row.status === "failed") {
      failed++;
      bucket.failed++;
    }
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    addNumber(bucket, "accepted_count", metadata.accepted_count);
    addNumber(bucket, "rejected_count", metadata.rejected_count ?? metadata.errors);
    addNumber(bucket, "message_count", metadata.message_count ?? metadata.sent);
    addNumber(bucket, "guest_sent_count", metadata.guest_sent_count);
    if (metadata.heartbeat && metadata.heartbeat !== "none") bucket.heartbeat_count++;
  }

  const byAction: Record<string, number> = {};
  for (const row of opsEvents.data ?? []) {
    const action = String(row.action ?? "unknown");
    byAction[action] = (byAction[action] ?? 0) + 1;
  }

  return {
    available: true,
    ...base,
    job_runs: {
      total: jobRuns.data?.length ?? 0,
      completed,
      failed,
      by_job: byJob,
    },
    ops_events: { total: opsEvents.data?.length ?? 0, by_action: byAction },
  };
}

async function main() {
  const quotaRows = rows.filter((row) => row.channel !== "reply");
  const baseline = sum(quotaRows, "baseline");
  const optimized = sum(quotaRows, "optimized");
  const quota = process.argv.includes("--quota")
    ? await fetchLineQuotaSnapshot()
    : null;
  const sourceAudit = process.argv.includes("--source")
    ? await fetchProductionSourceAudit()
    : null;
  console.log(
    JSON.stringify(
      {
        mode: quota ? "dry-run-with-readonly-quota" : "dry-run-fixture",
        fixture: "30-day-small-cafe-test-scenario",
        rows,
        baseline_monthly_units: baseline,
        optimized_monthly_units: optimized,
        estimated_saved_units: baseline - optimized,
        estimated_saving_ratio: Number(((baseline - optimized) / baseline).toFixed(4)),
        group_only_baseline_units: sum(rows.filter((row) => row.channel === "group"), "baseline"),
        group_only_optimized_units: sum(rows.filter((row) => row.channel === "group"), "optimized"),
        quota,
        source_audit: sourceAudit,
        caveat:
          "LINE quota is channel-wide; group usage is multiplied by actual group recipients and includes OA Manager sends. The optional --source report is read-only and aggregates production job_runs/ops_events without printing raw payloads.",
      },
      null,
      2
    )
  );
}

void main();
