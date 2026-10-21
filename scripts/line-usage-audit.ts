import { fetchCustomerLineQuotaAudits, fetchLineQuotaAudit } from "../src/lib/line-usage";
import { createClient } from "@supabase/supabase-js";

type UsageRow = {
  source: string;
  priority: "critical" | "actionable" | "informational";
  channel: "group" | "guest" | "reply";
  baselineRequests: number;
  optimizedRequests: number;
  note: string;
};

// Dry-run fixture: 30 days, based on the current test scenarios and a
// conservative small-cafe operating month. It is deliberately not presented
// as production truth when no production credential is supplied.
const rows: UsageRow[] = [
  { source: "D-1 group digest", priority: "actionable", channel: "group", baselineRequests: 30, optimizedRequests: 30, note: "existing one digest/day" },
  { source: "D-1 guest digest", priority: "actionable", channel: "guest", baselineRequests: 75, optimizedRequests: 75, note: "existing per-recipient digest" },
  { source: "D-7 guest digest", priority: "informational", channel: "guest", baselineRequests: 40, optimizedRequests: 40, note: "existing per-recipient digest" },
  { source: "deposit initial + urgent", priority: "actionable", channel: "guest", baselineRequests: 45, optimizedRequests: 45, note: "preserved two-stage deadline reminder" },
  { source: "deposit release guest", priority: "critical", channel: "guest", baselineRequests: 20, optimizedRequests: 20, note: "preserved per guest" },
  { source: "deposit release group", priority: "critical", channel: "group", baselineRequests: 20, optimizedRequests: 4, note: "20 cards, max 5 Flex objects/request" },
  { source: "new booking group", priority: "actionable", channel: "group", baselineRequests: 60, optimizedRequests: 60, note: "transactional staff alert" },
  { source: "payment review group", priority: "actionable", channel: "group", baselineRequests: 15, optimizedRequests: 15, note: "preserved manual-review alert" },
  { source: "payment approved group + guest", priority: "critical", channel: "group", baselineRequests: 25, optimizedRequests: 25, note: "provider retry/idempotency preserved" },
  { source: "payment approved guest", priority: "critical", channel: "guest", baselineRequests: 25, optimizedRequests: 25, note: "provider retry/idempotency preserved" },
  { source: "cancel/reschedule/attendance guest", priority: "actionable", channel: "guest", baselineRequests: 43, optimizedRequests: 43, note: "existing lifecycle dedupe preserved" },
  { source: "reschedule/attendance/waitlist group", priority: "actionable", channel: "group", baselineRequests: 36, optimizedRequests: 36, note: "immediate staff action" },
  { source: "waitlist guest", priority: "actionable", channel: "guest", baselineRequests: 6, optimizedRequests: 6, note: "confirmation window preserved" },
  { source: "review invite guest", priority: "informational", channel: "guest", baselineRequests: 10, optimizedRequests: 10, note: "existing one-shot stamp" },
  { source: "empty/already-notified heartbeat", priority: "informational", channel: "group", baselineRequests: 30, optimizedRequests: 15, note: "36h unchanged-state cooldown; heartbeat retained" },
  { source: "cron failure alert", priority: "critical", channel: "group", baselineRequests: 1, optimizedRequests: 1, note: "failure handling preserved" },
  { source: "webhook replies", priority: "actionable", channel: "reply", baselineRequests: 30, optimizedRequests: 30, note: "LINE reply messages are not quota-counted" },
];

function sumRequests(items: UsageRow[], key: "baselineRequests" | "optimizedRequests") {
  return items.reduce((total, row) => total + row[key], 0);
}

function quotaUnits(row: UsageRow, key: "baselineRequests" | "optimizedRequests", groupMembers: number): number {
  if (row.channel === "reply") return 0;
  const recipients = row.channel === "group" ? groupMembers : 1;
  return row[key] * recipients;
}

function sumQuotaUnits(items: UsageRow[], key: "baselineRequests" | "optimizedRequests", groupMembers: number): number {
  return items.reduce((total, row) => total + quotaUnits(row, key, groupMembers), 0);
}

function positiveIntegerArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function reportRow(row: UsageRow, groupMembers: number) {
  return {
    source: row.source,
    priority: row.priority,
    channel: row.channel,
    baseline_requests: row.baselineRequests,
    optimized_requests: row.optimizedRequests,
    recipient_count_assumption: row.channel === "group" ? groupMembers : row.channel === "guest" ? 1 : 0,
    baseline_units: quotaUnits(row, "baselineRequests", groupMembers),
    optimized_units: quotaUnits(row, "optimizedRequests", groupMembers),
    note: row.note,
  };
}

type ProductionSourceAudit = {
  source: "supabase_job_runs_ops_events";
  status: "complete" | "partial" | "unavailable";
  window_start: string;
  window_end: string;
  job_runs: {
    available: boolean;
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
    reason?: string;
  };
  ops_events: {
    available: boolean;
    total: number;
    by_action: Record<string, number>;
    reason?: string;
  };
};

type JobRunBuckets = ProductionSourceAudit["job_runs"]["by_job"];

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
    return {
      source: "supabase_job_runs_ops_events",
      status: "unavailable",
      ...base,
      job_runs: { available: false, total: 0, completed: 0, failed: 0, by_job: {}, reason: "Supabase read-only credentials unavailable" },
      ops_events: { available: false, total: 0, by_action: {}, reason: "Supabase read-only credentials unavailable" },
    };
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

  const jobRunsAvailable = !jobRuns.error;
  const opsEventsAvailable = !opsEvents.error;
  const availableCount = Number(jobRunsAvailable) + Number(opsEventsAvailable);
  return {
    source: "supabase_job_runs_ops_events",
    status: availableCount === 2 ? "complete" : availableCount === 1 ? "partial" : "unavailable",
    ...base,
    job_runs: {
      available: jobRunsAvailable,
      total: jobRuns.data?.length ?? 0,
      completed,
      failed,
      by_job: byJob,
      ...(jobRuns.error ? { reason: "job_runs unavailable or unreadable" } : {}),
    },
    ops_events: {
      available: opsEventsAvailable,
      total: opsEvents.data?.length ?? 0,
      by_action: byAction,
      ...(opsEvents.error ? { reason: "ops_events unavailable or unreadable" } : {}),
    },
  };
}

async function main() {
  const groupMembers = positiveIntegerArg("--group-members", 1);
  const quotaRows = rows.filter((row) => row.channel !== "reply");
  const baseline = sumQuotaUnits(quotaRows, "baselineRequests", groupMembers);
  const optimized = sumQuotaUnits(quotaRows, "optimizedRequests", groupMembers);
  const [quotaAudit, customerQuotaAudits, sourceAudit] = await Promise.all([
    process.argv.includes("--quota") ? fetchLineQuotaAudit() : Promise.resolve(null),
    process.argv.includes("--quota") ? fetchCustomerLineQuotaAudits() : Promise.resolve(null),
    process.argv.includes("--source") ? fetchProductionSourceAudit() : Promise.resolve(null),
  ]);
  console.log(
    JSON.stringify(
      {
        mode: "simulation",
        fixture: "30-day-small-cafe-test-scenario",
        simulation_assumptions: {
          group_member_count: groupMembers,
          guest_recipient_count: 1,
          reply_recipient_count: 0,
          note: "Replace group_member_count with measured production membership; these are not production consumption figures.",
        },
        rows: rows.map((row) => reportRow(row, groupMembers)),
        baseline_monthly_requests: sumRequests(quotaRows, "baselineRequests"),
        optimized_monthly_requests: sumRequests(quotaRows, "optimizedRequests"),
        baseline_monthly_units: baseline,
        optimized_monthly_units: optimized,
        estimated_saved_units: baseline - optimized,
        estimated_saving_ratio: Number(((baseline - optimized) / baseline).toFixed(4)),
        group_only_baseline_requests: sumRequests(rows.filter((row) => row.channel === "group"), "baselineRequests"),
        group_only_optimized_requests: sumRequests(rows.filter((row) => row.channel === "group"), "optimizedRequests"),
        group_only_baseline_units: sumQuotaUnits(rows.filter((row) => row.channel === "group"), "baselineRequests", groupMembers),
        group_only_optimized_units: sumQuotaUnits(rows.filter((row) => row.channel === "group"), "optimizedRequests", groupMembers),
        quota_audit: quotaAudit,
        customer_quota_audits: customerQuotaAudits,
        source_audit: sourceAudit,
        caveat:
          "This is a simulation of LINE recipient units: each push request is multiplied by its recipient count. Group membership and source mix are not production evidence until the operator supplies read-only LINE/Supabase results.",
      },
      null,
      2
    )
  );
}

void main();
