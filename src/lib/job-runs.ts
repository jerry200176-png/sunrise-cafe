/**
 * Cron job run persistence — observability for Vercel scheduled jobs.
 * Degrades gracefully when job_runs table is not migrated yet.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { notifyCronFailure, errorToDetail } from "@/lib/cron-alert";
import { logOps } from "@/lib/ops-log";
import { isAdminConfigured } from "@/lib/supabase-admin";

export type JobRunStatus = "running" | "completed" | "failed";

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
      Number(json.sent ?? json.released ?? json.reminded ?? json.items_processed ?? 0) || 0;
    const errors = Number(json.errors ?? 0) || 0;
    const error_detail = typeof json.error === "string" ? json.error : null;
    return { items_processed: items, metadata: json, errors, error_detail };
  } catch {
    return { items_processed: 0, metadata: {}, errors: 0, error_detail: null };
  }
}

/** Wrap a cron handler with job_runs persistence + failure recording. */
export async function runCronJob(
  jobName: string,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
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

    await finishJobRun(runId, {
      status,
      items_processed,
      metadata,
      error_message,
    });

    if (!ok || partialFailure) {
      await notifyCronFailure(jobName, error_message ?? `Cron ${jobName} failed`);
      logOps("cron", partialFailure ? "cron.partial_failure" : "cron.failure_notified", {
        job_name: jobName,
        error_message,
        items_processed,
        errors,
      });
    } else {
      logOps("cron", "cron.completed", {
        job_name: jobName,
        items_processed,
        status: res.status,
      });
    }
    return res;
  } catch (err) {
    await finishJobRun(runId, {
      status: "failed",
      error_message: errorToDetail(err),
    });
    await notifyCronFailure(jobName, err);
    const message = errorToDetail(err);
    logOps("cron", "cron.run_failed", { job_name: jobName, error_message: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const CRON_JOB_NAMES = [
  "send-line",
  "send-line-7d",
  "deposit-deadline",
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
