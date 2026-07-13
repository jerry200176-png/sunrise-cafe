/**
 * Outcome Pipeline — production-backed business metrics (replaces manual SQL rituals).
 */
import { createClient } from "@supabase/supabase-js";
import { isPaymentEventsTableReady } from "@/lib/payment-events-admin";
import { isAdminConfigured } from "@/lib/supabase-admin";
import {
  fetchMigrationDrift,
  TRACKED_MIGRATIONS,
} from "@/lib/migration-verify";
import { fetchCronJobSummaries, type JobRunSummary } from "@/lib/job-runs";
import { fetchProductionVersion, deploymentShaParity } from "@/lib/production-version";
import { fetchFunnelMetrics, type FunnelMetrics } from "@/lib/ops-metrics";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type OutcomeHealthBlock = {
  date: string;
  deposit_rate_pct: number | null;
  waitlist_conversion_pct: number | null;
    payment_review_oldest_hours: number | null;
    payment_review_sla_breached: boolean;
    migrations_all_applied: "yes" | "no";
  overlap_constraint_active: "yes" | "no";
  evidence_source: string;
  reviewer: string;
};

export type OutcomeSnapshot = {
  collected_at: string;
  status: "ok" | "degraded" | "unavailable";
  health_block: OutcomeHealthBlock;
  booking: {
    bookings_30d: number;
    bookings_7d: number;
    cancellation_rate_30d: number | null;
    cancellation_count_30d: number;
  };
  payment: {
    deposit_rate_pct: number | null;
    deposit_paid_30d: number;
    deposit_eligible_30d: number;
    pending_reviews: number;
    payment_review_oldest_hours: number | null;
    payment_review_median_hours_7d: number | null;
    payment_review_sla_compliance_pct_7d: number | null;
    payment_events_ready: boolean;
    deposit_at_risk: number;
  };
  cancellation: {
    cancelled_30d: number;
    auto_release_proxy_7d: number;
  };
  refund: {
    tracked: boolean;
    note: string;
    rejected_payments_7d: number;
  };
  waitlist: {
    joined_30d: number;
    converted_30d: number;
    conversion_pct: number | null;
  };
  cron: {
    scheduled_jobs: string[];
    deposit_reminders_7d: number;
    tomorrow_reminders_pending: number;
    auto_releases_7d: number;
    job_runs_ready: boolean;
    jobs: JobRunSummary[];
  };
  deployment: {
    commit: string | null;
    live_commit: string | null;
    live_commit_short: string | null;
    repository_commit: string | null;
    sha_parity: boolean | null;
    production_reachable: boolean;
    health_ok: boolean;
    service_role_configured: boolean;
  };
  migrations: {
    schema_migrations_table: boolean;
    applied: string[];
    pending: string[];
    all_required_applied: boolean;
    overlap_constraint_active: boolean;
    closed_dates_column: boolean;
    rbac_tables: boolean;
  };
  support: {
    pending_payment_reviews: number;
    rejected_events_7d: number;
    note: string;
  };
  funnel: FunnelMetrics;
};

export function calcDepositRate(paid: number, eligible: number): number | null {
  if (eligible <= 0) return null;
  return Math.round((paid / eligible) * 1000) / 10;
}

export function calcConversionRate(converted: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((converted / total) * 1000) / 10;
}

export function hoursSince(iso: string, now = new Date()): number {
  const ms = now.getTime() - new Date(iso).getTime();
  return Math.max(0, Math.round((ms / (60 * 60 * 1000)) * 10) / 10);
}

export function buildHealthBlock(snapshot: Omit<OutcomeSnapshot, "health_block"> & { health_block?: never }): OutcomeHealthBlock {
  const slaHours = 4;
  const reviewBreached =
    snapshot.payment.payment_review_oldest_hours != null &&
    snapshot.payment.payment_review_oldest_hours > slaHours;
  return {
    date: snapshot.collected_at.slice(0, 10),
    deposit_rate_pct: snapshot.payment.deposit_rate_pct,
    waitlist_conversion_pct: snapshot.waitlist.conversion_pct,
    payment_review_oldest_hours: snapshot.payment.payment_review_oldest_hours,
    payment_review_sla_breached: reviewBreached,
    migrations_all_applied: snapshot.migrations.all_required_applied ? "yes" : "no",
    overlap_constraint_active: snapshot.migrations.overlap_constraint_active ? "yes" : "no",
    evidence_source: "outcome-pipeline:/api/cto/outcomes",
    reviewer: "automated",
  };
}

async function buildDeploymentMetrics(repositoryCommit: string | null) {
  const prod = await fetchProductionVersion();
  const healthRes = await fetch(
    `${(process.env.PROD_URL ?? "https://sunrise-cafe-six.vercel.app").replace(/\/$/, "")}/api/booking-health`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) }
  ).catch(() => null);
  const healthOk = healthRes?.ok
    ? ((await healthRes.json().catch(() => ({}))) as { ok?: boolean }).ok === true
    : false;

  const repoShort = repositoryCommit?.slice(0, 7) ?? null;
  const liveShort = prod.commit_short;

  return {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? repoShort,
    live_commit: prod.commit,
    live_commit_short: liveShort,
    repository_commit: repoShort,
    sha_parity: deploymentShaParity(repoShort, liveShort),
    production_reachable: prod.reachable,
    health_ok: healthOk,
    service_role_configured: isAdminConfigured(),
  };
}

async function fetchMigrationStatus() {
  const drift = await fetchMigrationDrift();
  return {
    schema_migrations_table: drift.schema_migrations_table,
    applied: drift.applied,
    pending: drift.pending,
    all_required_applied:
      drift.pending.length === 0 && drift.closed_dates_column && drift.overlap_constraint_active,
    overlap_constraint_active: drift.overlap_constraint_active,
    closed_dates_column: drift.closed_dates_column,
    rbac_tables: drift.rbac_tables,
  };
}

async function fetchBookingMetrics(now: Date) {
  const since30 = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();
  const since7 = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();

  const { data: rows30, error } = await db()
    .from("reservations")
    .select("status, created_at, start_time, is_deposit_paid, total_price")
    .gte("created_at", since30);

  if (error) throw error;

  const all = rows30 ?? [];
  const activeStatuses = new Set(["pending", "confirmed", "checked_in", "completed"]);
  const active = all.filter((r) => activeStatuses.has(r.status as string));
  const cancelled = all.filter((r) => r.status === "cancelled");

  const bookings7d = all.filter((r) => (r.created_at as string) >= since7 && r.status !== "cancelled").length;

  return {
    bookings_30d: active.length,
    bookings_7d: bookings7d,
    cancellation_rate_30d: all.length ? Math.round((cancelled.length / all.length) * 1000) / 1000 : null,
    cancellation_count_30d: cancelled.length,
    depositEligible: active.filter(
      (r) => r.total_price != null && Number(r.total_price) > 0
    ),
    depositPaid: active.filter(
      (r) =>
        r.total_price != null &&
        Number(r.total_price) > 0 &&
        r.is_deposit_paid === true
    ),
    cancelled7d: all.filter(
      (r) =>
        r.status === "cancelled" &&
        (r.created_at as string) >= since7 &&
        r.is_deposit_paid === false
    ),
  };
}

async function fetchWaitlistMetrics(now: Date) {
  const since30 = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();
  const { data, error } = await db()
    .from("waitlist")
    .select("status, created_at")
    .gte("created_at", since30);

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "PGRST205" || /waitlist/i.test(error.message)) {
      return { joined_30d: 0, converted_30d: 0, conversion_pct: null };
    }
    throw error;
  }

  const rows = data ?? [];
  const converted = rows.filter((r) => r.status === "booked").length;
  return {
    joined_30d: rows.length,
    converted_30d: converted,
    conversion_pct: calcConversionRate(converted, rows.length),
  };
}

async function fetchPaymentMetrics(
  depositEligible: { is_deposit_paid: boolean }[],
  depositPaid: { is_deposit_paid: boolean }[],
  now: Date
) {
  const paymentEventsReady = await isPaymentEventsTableReady();
  let pendingReviews = 0;
  let oldestHours: number | null = null;
  let rejected7d = 0;
  let medianHours: number | null = null;
  let slaCompliance: number | null = null;

  if (paymentEventsReady) {
    const { data: pending, error } = await db()
      .from("payment_events")
      .select("created_at")
      .eq("status", "pending_review")
      .order("created_at", { ascending: true });

    if (error) throw error;
    pendingReviews = pending?.length ?? 0;
    if (pending?.length) {
      oldestHours = hoursSince(pending[0].created_at as string, now);
    }

    const since7 = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();
    const { count } = await db()
      .from("payment_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "rejected")
      .gte("created_at", since7);
    rejected7d = count ?? 0;

    const { data: reviewed, error: reviewedErr } = await db()
      .from("payment_events")
      .select("created_at, reviewed_at")
      .in("status", ["approved", "rejected"])
      .not("reviewed_at", "is", null)
      .gte("reviewed_at", since7);
    if (reviewedErr) throw reviewedErr;

    if (reviewed?.length) {
      const durations = reviewed
        .map((r) => hoursSince(r.created_at as string, new Date(r.reviewed_at as string)))
        .sort((a, b) => a - b);
      const mid = Math.floor(durations.length / 2);
      medianHours =
        durations.length % 2 === 0
          ? Math.round(((durations[mid - 1] + durations[mid]) / 2) * 10) / 10
          : durations[mid];
      const withinSla = durations.filter((h) => h <= 4).length;
      slaCompliance = Math.round((withinSla / durations.length) * 1000) / 10;
    }
  }

  const { count: atRisk } = await db()
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "confirmed"])
    .eq("is_deposit_paid", false);

  return {
    deposit_rate_pct: calcDepositRate(depositPaid.length, depositEligible.length),
    deposit_paid_30d: depositPaid.length,
    deposit_eligible_30d: depositEligible.length,
    pending_reviews: pendingReviews,
    payment_review_oldest_hours: oldestHours,
    payment_review_median_hours_7d: paymentEventsReady ? medianHours : null,
    payment_review_sla_compliance_pct_7d: paymentEventsReady ? slaCompliance : null,
    payment_events_ready: paymentEventsReady,
    deposit_at_risk: atRisk ?? 0,
    rejected_events_7d: rejected7d,
  };
}

async function fetchCronProxies(now: Date) {
  const since7 = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString();
  const tomorrowStart = new Date(now);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  const { count: reminders7d } = await db()
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .not("deposit_reminder_sent_at", "is", null)
    .gte("deposit_reminder_sent_at", since7);

  const { count: pendingTomorrow } = await db()
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "confirmed", "checked_in"])
    .eq("is_notified", false)
    .gte("start_time", tomorrowStart.toISOString())
    .lt("start_time", tomorrowEnd.toISOString());

  const { count: autoReleases7d } = await db()
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("status", "cancelled")
    .eq("is_deposit_paid", false)
    .gte("created_at", since7);

  return {
    scheduled_jobs: [
      "/api/admin/reminders/send-line",
      "/api/admin/reminders/send-line-7d",
      "/api/admin/reminders/deposit-deadline",
      "/api/admin/reminders/deploy-health",
    ],
    deposit_reminders_7d: reminders7d ?? 0,
    tomorrow_reminders_pending: pendingTomorrow ?? 0,
    auto_releases_7d: autoReleases7d ?? 0,
  };
}

async function buildCronMetrics(now: Date) {
  const proxies = await fetchCronProxies(now);
  const jobSummary = await fetchCronJobSummaries();
  return {
    ...proxies,
    job_runs_ready: jobSummary.ready,
    jobs: jobSummary.jobs,
  };
}

/** Collect all outcome metrics from production Supabase. */
export async function collectOutcomeMetrics(
  options?: { repositoryCommit?: string | null }
): Promise<OutcomeSnapshot> {
  const now = new Date();
  const collected_at = now.toISOString();
  const repositoryCommit =
    options?.repositoryCommit ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    null;

  const deploymentBase = await buildDeploymentMetrics(repositoryCommit);

  if (!isAdminConfigured()) {
    return {
      collected_at,
      status: "unavailable",
      health_block: {
        date: collected_at.slice(0, 10),
        deposit_rate_pct: null,
        waitlist_conversion_pct: null,
        payment_review_oldest_hours: null,
        payment_review_sla_breached: false,
        migrations_all_applied: "no",
        overlap_constraint_active: "no",
        evidence_source: "outcome-pipeline:unavailable",
        reviewer: "automated",
      },
      booking: {
        bookings_30d: 0,
        bookings_7d: 0,
        cancellation_rate_30d: null,
        cancellation_count_30d: 0,
      },
      payment: {
        deposit_rate_pct: null,
        deposit_paid_30d: 0,
        deposit_eligible_30d: 0,
        pending_reviews: 0,
        payment_review_oldest_hours: null,
        payment_review_median_hours_7d: null,
        payment_review_sla_compliance_pct_7d: null,
        payment_events_ready: false,
        deposit_at_risk: 0,
      },
      cancellation: { cancelled_30d: 0, auto_release_proxy_7d: 0 },
      refund: {
        tracked: false,
        note: "No refund ledger — use rejected payment events + cancelled unpaid as proxy",
        rejected_payments_7d: 0,
      },
      waitlist: { joined_30d: 0, converted_30d: 0, conversion_pct: null },
      cron: {
        scheduled_jobs: [],
        deposit_reminders_7d: 0,
        tomorrow_reminders_pending: 0,
        auto_releases_7d: 0,
        job_runs_ready: false,
        jobs: [],
      },
      deployment: deploymentBase,
      migrations: {
        schema_migrations_table: false,
        applied: [],
        pending: TRACKED_MIGRATIONS.map((m) => m.version),
        all_required_applied: false,
        overlap_constraint_active: false,
        closed_dates_column: false,
        rbac_tables: false,
      },
      support: {
        pending_payment_reviews: 0,
        rejected_events_7d: 0,
        note: "No ticket system — payment review queue is support proxy",
      },
      funnel: await fetchFunnelMetrics(now),
    };
  }

  try {
    const [booking, waitlist, migrations, cron, funnel] = await Promise.all([
      fetchBookingMetrics(now),
      fetchWaitlistMetrics(now),
      fetchMigrationStatus(),
      buildCronMetrics(now),
      fetchFunnelMetrics(now),
    ]);

    const payment = await fetchPaymentMetrics(
      booking.depositEligible,
      booking.depositPaid,
      now
    );

    const deployment = deploymentBase;

    const partial = {
      collected_at,
      status: "ok" as const,
      booking: {
        bookings_30d: booking.bookings_30d,
        bookings_7d: booking.bookings_7d,
        cancellation_rate_30d: booking.cancellation_rate_30d,
        cancellation_count_30d: booking.cancellation_count_30d,
      },
      payment: {
        deposit_rate_pct: payment.deposit_rate_pct,
        deposit_paid_30d: payment.deposit_paid_30d,
        deposit_eligible_30d: payment.deposit_eligible_30d,
        pending_reviews: payment.pending_reviews,
        payment_review_oldest_hours: payment.payment_review_oldest_hours,
        payment_review_median_hours_7d: payment.payment_review_median_hours_7d,
        payment_review_sla_compliance_pct_7d: payment.payment_review_sla_compliance_pct_7d,
        payment_events_ready: payment.payment_events_ready,
        deposit_at_risk: payment.deposit_at_risk,
      },
      cancellation: {
        cancelled_30d: booking.cancellation_count_30d,
        auto_release_proxy_7d: booking.cancelled7d.length,
      },
      refund: {
        tracked: false,
        note: "No refund ledger — use rejected payment events + cancelled unpaid as proxy",
        rejected_payments_7d: payment.rejected_events_7d,
      },
      waitlist,
      cron,
      deployment,
      migrations,
      support: {
        pending_payment_reviews: payment.pending_reviews,
        rejected_events_7d: payment.rejected_events_7d,
        note: "No ticket system — payment review queue is support proxy",
      },
      funnel,
    };

    return {
      ...partial,
      health_block: buildHealthBlock(partial),
    };
  } catch (err) {
    console.error("[outcome-pipeline] collect failed:", err);
    return {
      collected_at,
      status: "degraded",
      health_block: {
        date: collected_at.slice(0, 10),
        deposit_rate_pct: null,
        waitlist_conversion_pct: null,
        payment_review_oldest_hours: null,
        payment_review_sla_breached: false,
        migrations_all_applied: "no",
        overlap_constraint_active: "no",
        evidence_source: "outcome-pipeline:error",
        reviewer: "automated",
      },
      booking: {
        bookings_30d: 0,
        bookings_7d: 0,
        cancellation_rate_30d: null,
        cancellation_count_30d: 0,
      },
      payment: {
        deposit_rate_pct: null,
        deposit_paid_30d: 0,
        deposit_eligible_30d: 0,
        pending_reviews: 0,
        payment_review_oldest_hours: null,
        payment_review_median_hours_7d: null,
        payment_review_sla_compliance_pct_7d: null,
        payment_events_ready: false,
        deposit_at_risk: 0,
      },
      cancellation: { cancelled_30d: 0, auto_release_proxy_7d: 0 },
      refund: {
        tracked: false,
        note: "Collection error",
        rejected_payments_7d: 0,
      },
      waitlist: { joined_30d: 0, converted_30d: 0, conversion_pct: null },
      cron: {
        scheduled_jobs: [],
        deposit_reminders_7d: 0,
        tomorrow_reminders_pending: 0,
        auto_releases_7d: 0,
        job_runs_ready: false,
        jobs: [],
      },
      deployment: deploymentBase,
      migrations: {
        schema_migrations_table: false,
        applied: [],
        pending: TRACKED_MIGRATIONS.map((m) => m.version),
        all_required_applied: false,
        overlap_constraint_active: false,
        closed_dates_column: false,
        rbac_tables: false,
      },
      support: {
        pending_payment_reviews: 0,
        rejected_events_7d: 0,
        note: "Collection error",
      },
      funnel: await fetchFunnelMetrics(now),
    };
  }
}
