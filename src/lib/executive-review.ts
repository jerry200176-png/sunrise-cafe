/**
 * Weekly Executive Review — auto-generated from North Star + improvement registry.
 */
import type { NorthStarSnapshot, NorthStarMetric } from "@/lib/north-star-metrics";

export type HypothesisVerdict = "pending" | "confirmed" | "rejected" | "inconclusive";

export type HypothesisRecord = {
  id: string;
  title: string;
  metrics: string[];
  verdict: HypothesisVerdict;
  verify_at: string;
  note: string;
};

export type RoiBacklogItem = {
  rank: number;
  id: string;
  title: string;
  friction: string;
  metrics: string[];
};

export type ExecutiveReview = {
  week_ending: string;
  generated_at: string;
  deliveries: string[];
  north_star_summary: {
    on_track: number;
    at_risk: number;
    unmeasured: number;
    metrics_changed: NorthStarMetric[];
  };
  hypotheses: {
    confirmed: HypothesisRecord[];
    rejected: HypothesisRecord[];
    pending: HypothesisRecord[];
  };
  stop_investing: string[];
  top_10_roi: RoiBacklogItem[];
  markdown: string;
};

/** Session deliverables — updated each weekly review run. */
export const WEEK_DELIVERIES: string[] = [
  "PR #133 CX-005 — deposit deadline UX + guest payment funnel telemetry",
  "PR #134 ADM-003 — payment review keyboard navigation",
  "PR #135 ADM-001 — admin waitlist management",
  "PR #136 OPS-004 — North Star framework + booking funnel telemetry",
  "PR (pending) — Improvement Loop v2: Hypothesis + Observed/Target KPIs + Weekly Review",
];

export const HYPOTHESIS_REGISTRY: HypothesisRecord[] = [
  {
    id: "CX-005",
    title: "Deposit deadline visibility increases deposit conversion",
    metrics: ["deposit_conversion", "payment_completion_rate", "customer_support_proxy"],
    verdict: "pending",
    verify_at: "T+7 after production deploy",
    note: "Blocked: Vercel production rate limit",
  },
  {
    id: "ADM-003",
    title: "Keyboard nav reduces payment review SLA",
    metrics: ["admin_payment_review_sla", "admin_keyboard_adoption"],
    verdict: "pending",
    verify_at: "T+14 after production deploy",
    note: "Keyboard adoption threshold 30% at T+14",
  },
  {
    id: "ADM-001",
    title: "Waitlist visibility improves conversion follow-up",
    metrics: ["waitlist_conversion", "customer_support_proxy"],
    verdict: "pending",
    verify_at: "T+7 after production deploy",
    note: "Staff could not see queue before",
  },
  {
    id: "ADM-002",
    title: "Inline confirm modals fix mobile admin task completion",
    metrics: ["customer_support_proxy", "production_error_rate"],
    verdict: "pending",
    verify_at: "T+7 after confirm slice deploy",
    note: "6 window.confirm replaced; alert/prompt remain in slice 2",
  },
];

export const TOP_10_ROI: RoiBacklogItem[] = [
  { rank: 1, id: "ADM-002", title: "ReservationList inline modals", friction: "Mobile confirm/prompt broken daily", metrics: ["admin_payment_review_sla"] },
  { rank: 2, id: "OPS-004b", title: "Ops-log funnel aggregation", friction: "Cannot measure booking/payment conversion", metrics: ["booking_conversion", "payment_completion_rate"] },
  { rank: 3, id: "CX-007", title: "Sticky payment CTA mobile", friction: "Payment CTA below fold on query", metrics: ["payment_completion_rate", "deposit_conversion"] },
  { rank: 4, id: "ADM-005", title: "Dashboard single API call", friction: "7 fetches every morning", metrics: ["api_latency_p95"] },
  { rank: 5, id: "CX-006", title: "Waitlist confirm i18n", friction: "EN/JA guests drop at confirm", metrics: ["waitlist_conversion", "booking_conversion"] },
  { rank: 6, id: "OPS-002", title: "Supabase migrations (#95)", friction: "Data integrity / overlap risk", metrics: ["production_error_rate"] },
  { rank: 7, id: "CX-008", title: "Booking form a11y", friction: "Focus order / labels on mobile", metrics: ["booking_conversion", "avg_booking_time"] },
  { rank: 8, id: "OPS-001", title: "Production SHA parity", friction: "Guests on stale build", metrics: ["production_error_rate"] },
  { rank: 9, id: "OPS-003", title: "OUTCOME_LOG auto-sync", friction: "Weekly compare manual", metrics: ["deposit_conversion"] },
  { rank: 10, id: "ADM-002b", title: "Replace alert() with toast", friction: "Errors invisible on mobile", metrics: ["customer_support_proxy"] },
];

export const STOP_INVESTING_CANDIDATES: string[] = [
  "Features with Compare = no effect after T+30 (none yet — first reviews pending deploy)",
  "Keyboard nav if adoption <10% at T+14 (ADM-003 rollback trigger)",
  "Bank CSV reconcile MVP if staff never uploads (usage TBD)",
];

function formatMetricLine(m: NorthStarMetric): string {
  const obs = m.observed != null ? `${m.observed}${m.unit === "%" ? "%" : ` ${m.unit}`}` : "—";
  const delta =
    m.delta != null
      ? ` (Δ ${m.delta > 0 ? "+" : ""}${m.delta}${m.unit === "%" ? "%" : ""} vs target)`
      : "";
  return `- **${m.name}**: Observed ${obs} / Target ${m.target}${m.unit === "%" ? "%" : ` ${m.unit}`}${delta} — ${m.status}`;
}

export function buildExecutiveReview(northStar: NorthStarSnapshot, weekEnding?: string): ExecutiveReview {
  const week = weekEnding ?? northStar.collected_at.slice(0, 10);
  const generatedAt = new Date().toISOString();

  const onTrack = northStar.metrics.filter((m) => m.status === "on_track").length;
  const atRisk = northStar.metrics.filter((m) => m.status === "at_risk").length;
  const unmeasured = northStar.metrics.filter((m) => m.status === "unmeasured").length;
  const changed = northStar.metrics.filter((m) => m.observed != null);

  const confirmed = HYPOTHESIS_REGISTRY.filter((h) => h.verdict === "confirmed");
  const rejected = HYPOTHESIS_REGISTRY.filter((h) => h.verdict === "rejected");
  const pending = HYPOTHESIS_REGISTRY.filter((h) => h.verdict === "pending");

  const md = [
    `# Weekly Executive Review — ${week}`,
    "",
    `**Generated:** ${generatedAt}`,
    "",
    "## 本週交付",
    ...WEEK_DELIVERIES.map((d) => `- ${d}`),
    "",
    "## North Star Metrics 變化",
    `| Status | Count |`,
    `|--------|------:|`,
    `| 🟢 on_track | ${onTrack} |`,
    `| 🟡 at_risk | ${atRisk} |`,
    `| 🔴 unmeasured | ${unmeasured} |`,
    "",
    "### Observed vs Target",
    ...northStar.metrics.map(formatMetricLine),
    "",
    "## Hypothesis 結果",
    "### 證實",
    ...(confirmed.length ? confirmed.map((h) => `- **${h.id}**: ${h.title}`) : ["- _none yet_"]),
    "",
    "### 否定",
    ...(rejected.length ? rejected.map((h) => `- **${h.id}**: ${h.title} — ${h.note}`) : ["- _none yet_"]),
    "",
    "### 待驗證",
    ...pending.map((h) => `- **${h.id}**: ${h.title} (${h.verify_at})`),
    "",
    "## 建議停止投入",
    ...STOP_INVESTING_CANDIDATES.map((s) => `- ${s}`),
    "",
    "## 下一週 Top 10 ROI",
    ...TOP_10_ROI.map((i) => `${i.rank}. **${i.id}** — ${i.title} · ${i.friction}`),
    "",
  ].join("\n");

  return {
    week_ending: week,
    generated_at: generatedAt,
    deliveries: WEEK_DELIVERIES,
    north_star_summary: {
      on_track: onTrack,
      at_risk: atRisk,
      unmeasured,
      metrics_changed: changed,
    },
    hypotheses: { confirmed, rejected, pending },
    stop_investing: STOP_INVESTING_CANDIDATES,
    top_10_roi: TOP_10_ROI,
    markdown: md,
  };
}
