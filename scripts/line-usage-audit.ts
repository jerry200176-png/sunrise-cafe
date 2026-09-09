import { fetchLineQuotaSnapshot } from "../src/lib/line-usage";

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

async function main() {
  const quotaRows = rows.filter((row) => row.channel !== "reply");
  const baseline = sum(quotaRows, "baseline");
  const optimized = sum(quotaRows, "optimized");
  const quota = process.argv.includes("--quota")
    ? await fetchLineQuotaSnapshot()
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
        caveat:
          "LINE quota is channel-wide; group usage is multiplied by actual group recipients and includes OA Manager sends. Source attribution is an estimate until production job_runs/ops_events and readonly quota are supplied.",
      },
      null,
      2
    )
  );
}

void main();
