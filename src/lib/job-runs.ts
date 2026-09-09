/**
 * Cron job run persistence — observability for Vercel scheduled jobs.
 * Degrades gracefully when job_runs table is not migrated yet.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { notifyCronFailure, errorToDetail } from "@/lib/cron-alert";
import { logOps } from "@/lib/ops-log";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { taipeiDateString } from "@/lib/datetime";

export type JobRunStatus = "running" | "completed" | "failed";

export type ReminderTriggerSource = "cron" | "manual" | "github";

export type CronJobOptions = {
  trigger_source?: ReminderTriggerSource;
};

export type JobRunSummary = {
  job_name: string;
  last_status: JobRunStatus;
  last_started_at: string;
  last_finished_at: string | null;
  last_items_processed: number;
  last_error: string | null;
  runs_7d: number;
  failed_7d: number;
};

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function isJobRunsTableReady(): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  const { error } = await db().from("job_runs").select("id").limit(1);
  if (!error) return true;
  const code = (error as { code?: string }).code;
  if (code === "PGRST205" || /job_runs/i.test(error.message)) return false;
  if (/invalid api key/i.test(error.message)) return false;
  throw error;
}

export async function startJobRun(job_name: string): Promise<string | null> {
  if (!isAdminConfigured()) return null;
  const { data, error } = await db()
    .from("job_runs")
    .insert({ job_name, status: "running" })
    .select("id")
    .single();
  if (error) {
    if (/job_runs/i.test(error.message)) return null;
    throw error;
  }
  return data.id as string;
}

export async function finishJobRun(
  id: string | null,
  result: {
    status: "completed" | "failed";
    items_processed?: number;
    error_message?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  if (!id) return;
  const { error } = await db()
    .from("job_runs")
    .update({
      status: result.status,
      finished_at: new Date().toISOString(),
      items_processed: result.items_processed ?? 0,
      error_message: result.error_message ?? null,
      metadata: result.metadata ?? {},
    })
    .eq("id", id);
  if (error && !/job_runs/i.test(error.message)) throw error;
}

async function extractResponseMeta(res: NextResponse): Promise<{
  items_processed: number;
  metadata: Record<string, unknown>;
  errors: number;
  error_detail: string | null;
}> {
  try {
    const json = (await res.clone().json()) as Record<string, unknown>;
    const items =
      Number(
        json.sent_count ??
          json.sent ??
          json.released ??
          json.reminded ??
          json.items_processed ??
          0
      ) || 0;
    const errors = Number(json.errors ?? 0) || 0;
    const error_detail = typeof json.error === "string" ? json.error : null;
    return { items_processed: items, metadata: json, errors, error_detail };
  } catch {
    return { items_processed: 0, metadata: {}, errors: 0, error_detail: null };
  }
}

/** Taipei calendar-day UTC bounds for job_runs idempotency queries. */
export function taipeiDayUtcBounds(now = new Date()): {
  date: string;
  startIso: string;
  endIso: string;
} {
  const date = taipeiDateString(now);
  return {
    date,
    startIso: new Date(`${date}T00:00:00+08:00`).toISOString(),
    endIso: new Date(`${date}T23:59:59.999+08:00`).toISOString(),
  };
}

const SUCCESS_REMINDER_RESULTS = new Set([
  "sent",
  "already_notified",
  "empty_cat",
]);

/**
 * True if send-line already completed successfully today (Taipei) and was not a duplicate_skip.
 * Used to keep cron + GitHub backup idempotent (no second LINE blast).
 */
export async function findSuccessfulSendLineRunToday(
  now = new Date()
): Promise<{ id: string; started_at: string; metadata: Record<string, unknown> } | null> {
  if (!isAdminConfigured()) return null;
  const { startIso, endIso } = taipeiDayUtcBounds(now);
  const { data, error } = await db()
    .from("job_runs")
    .select("id, started_at, status, metadata")
    .eq("job_name", "send-line")
    .eq("status", "completed")
    .gte("started_at", startIso)
    .lte("started_at", endIso)
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    if (/job_runs/i.test(error.message)) return null;
    throw error;
  }

  for (const row of data ?? []) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    if (meta.duplicate === true || meta.result === "duplicate_skip") continue;
    const result = typeof meta.result === "string" ? meta.result : null;
    // Legacy rows without result but completed with any sent — treat as success
    if (result && SUCCESS_REMINDER_RESULTS.has(result)) {
      return {
        id: row.id as string,
        started_at: row.started_at as string,
        metadata: meta,
      };
    }
    if (!result && row.status === "completed") {
      return {
        id: row.id as string,
        started_at: row.started_at as string,
        metadata: meta,
      };
    }
  }
  return null;
}

/**
 * Informational heartbeat cooldown. A repeated empty/already-notified state
 * does not need another push within the same 36-hour window. If job_runs is
 * unavailable, return false so the existing heartbeat behavior is preserved.
 */
export async function findRecentSendLineHeartbeat(
  heartbeatKey: string,
  now = new Date(),
  cooldownHours = 36
): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  const since = new Date(now.getTime() - cooldownHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from("job_runs")
    .select("metadata")
    .eq("job_name", "send-line")
    .eq("status", "completed")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    if (/job_runs/i.test(error.message)) return false;
    throw error;
  }
  return (data ?? []).some((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const keys = Array.isArray(metadata.heartbeat_keys)
      ? metadata.heartbeat_keys.filter((key): key is string => typeof key === "string")
      : [];
    return keys.includes(heartbeatKey);
  });
}

/** Wrap a cron handler with job_runs persistence + failure recording. */
export async function runCronJob(
  jobName: string,
  handler: () => Promise<NextResponse>,
  options: CronJobOptions = {}
): Promise<NextResponse> {
  const runStarted = Date.now();
  const runId = await startJobRun(jobName);
  try {
    const res = await handler();
    const ok = res.status < 400;
    const { items_processed, metadata, errors, error_detail } = await extractResponseMeta(res);
    const partialFailure = ok && errors > 0;
    const status = ok && !partialFailure ? "completed" : "failed";
    const error_message = !ok
      ? (error_detail ?? `HTTP ${res.status}`)
      : partialFailure
        ? `${errors} item(s) failed`
        : undefined;

    const enrichedMeta: Record<string, unknown> = {
      ...metadata,
      trigger_source: metadata.trigger_source ?? options.trigger_source ?? null,
      job_name: jobName,
      wall_duration_ms: Date.now() - runStarted,
    };

    await finishJobRun(runId, {
      status,
      items_processed,
      metadata: enrichedMeta,
      error_message,
    });

    if (!ok || partialFailure) {
      await notifyCronFailure(jobName, error_message ?? `Cron ${jobName} failed`);
      logOps("cron", partialFailure ? "cron.partial_failure" : "cron.failure_notified", {
        job_name: jobName,
        error_message,
        items_processed,
        errors,
        trigger_source: enrichedMeta.trigger_source,
        result: enrichedMeta.result ?? null,
        duration_ms: enrichedMeta.duration_ms ?? enrichedMeta.wall_duration_ms,
      });
    } else {
      logOps("cron", "cron.completed", {
        job_name: jobName,
        items_processed,
        status: res.status,
        trigger_source: enrichedMeta.trigger_source,
        result: enrichedMeta.result ?? null,
        sent_count: enrichedMeta.sent_count ?? items_processed,
        skipped_count: enrichedMeta.skipped_count ?? 0,
        reservation_count: enrichedMeta.reservation_count ?? null,
        duration_ms: enrichedMeta.duration_ms ?? enrichedMeta.wall_duration_ms,
      });
    }
    return res;
  } catch (err) {
    await finishJobRun(runId, {
      status: "failed",
      error_message: errorToDetail(err),
      metadata: {
        trigger_source: options.trigger_source ?? null,
        result: "error",
        error: errorToDetail(err),
        wall_duration_ms: Date.now() - runStarted,
      },
    });
    await notifyCronFailure(jobName, err);
    const message = errorToDetail(err);
    logOps("cron", "cron.run_failed", {
      job_name: jobName,
      error_message: message,
      trigger_source: options.trigger_source ?? null,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const CRON_JOB_NAMES = [
  "send-line",
  "send-line-7d",
  "deposit-deadline",
  "deploy-health",
] as const;

/** Latest run per cron job (7-day window stats). */
export async function fetchCronJobSummaries(): Promise<{
  ready: boolean;
  jobs: JobRunSummary[];
}> {
  if (!isAdminConfigured()) {
    return { ready: false, jobs: [] };
  }
  const ready = await isJobRunsTableReady();
  if (!ready) {
    return { ready: false, jobs: [] };
  }

  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from("job_runs")
    .select("job_name, status, started_at, finished_at, items_processed, error_message")
    .gte("started_at", since7)
    .order("started_at", { ascending: false });

  if (error) throw error;
  const rows = data ?? [];

  const jobs: JobRunSummary[] = CRON_JOB_NAMES.map((job_name) => {
    const jobRows = rows.filter((r) => r.job_name === job_name);
    const latest = jobRows[0];
    return {
      job_name,
      last_status: (latest?.status as JobRunStatus) ?? "failed",
      last_started_at: latest?.started_at ?? "",
      last_finished_at: (latest?.finished_at as string | null) ?? null,
      last_items_processed: (latest?.items_processed as number) ?? 0,
      last_error: (latest?.error_message as string | null) ?? null,
      runs_7d: jobRows.length,
      failed_7d: jobRows.filter((r) => r.status === "failed").length,
    };
  });

  return { ready: true, jobs };
}
