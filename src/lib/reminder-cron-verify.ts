/**
 * Read-only diagnostics for tomorrow LINE reminder cron (send-line).
 */
import { createClient } from "@supabase/supabase-js";
import { isJobRunsTableReady } from "@/lib/job-runs";
import { isLineConfigured } from "@/lib/line-notify";
import { isAdminConfigured } from "@/lib/supabase-admin";

export type ReminderCronVerify = {
  checked_at: string;
  line_configured: boolean;
  job_runs_ready: boolean;
  last_send_line: {
    status: string | null;
    started_at: string | null;
    finished_at: string | null;
    items_processed: number | null;
    error_message: string | null;
    sent: number | null;
    message: string | null;
    trigger_source: string | null;
    result: string | null;
    duration_ms: number | null;
    reservation_count: number | null;
    skipped_count: number | null;
    guest_sent_count: number | null;
    heartbeat: string | null;
    duplicate: boolean | null;
  } | null;
  branches: { name: string; has_line_group_id: boolean; line_group_id_prefix: string | null }[];
  multi_branch_mode: boolean;
  tomorrow: {
    date: string;
    total_active: number;
    pending_notify: number;
    already_notified: number;
  };
  diagnosis: string[];
};

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function taipeiTomorrowRange(now = new Date()) {
  const nowTW = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const tomorrow = new Date(nowTW);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getDate()).padStart(2, "0");
  return {
    date: `${y}-${m}-${d}`,
    start: `${y}-${m}-${d}T00:00:00+08:00`,
    end: `${y}-${m}-${d}T23:59:59.999+08:00`,
  };
}

export async function verifyReminderCron(now = new Date()): Promise<ReminderCronVerify> {
  const diagnosis: string[] = [];
  const range = taipeiTomorrowRange(now);

  if (!isAdminConfigured()) {
    return {
      checked_at: now.toISOString(),
      line_configured: isLineConfigured(),
      job_runs_ready: false,
      last_send_line: null,
      branches: [],
      multi_branch_mode: false,
      tomorrow: { date: range.date, total_active: 0, pending_notify: 0, already_notified: 0 },
      diagnosis: ["SUPABASE_SERVICE_ROLE_KEY 未設定，無法查詢訂位與 cron 紀錄"],
    };
  }

  const jobRunsReady = await isJobRunsTableReady();
  let lastSendLine: ReminderCronVerify["last_send_line"] = null;

  if (jobRunsReady) {
    const { data } = await db()
      .from("job_runs")
      .select("status, started_at, finished_at, items_processed, error_message, metadata")
      .eq("job_name", "send-line")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const meta = (data.metadata ?? {}) as Record<string, unknown>;
      lastSendLine = {
        status: data.status as string,
        started_at: data.started_at as string,
        finished_at: (data.finished_at as string | null) ?? null,
        items_processed: (data.items_processed as number) ?? null,
        error_message: (data.error_message as string | null) ?? null,
        sent:
          typeof meta.sent_count === "number"
            ? meta.sent_count
            : typeof meta.sent === "number"
              ? meta.sent
              : null,
        message: typeof meta.message === "string" ? meta.message : null,
        trigger_source: typeof meta.trigger_source === "string" ? meta.trigger_source : null,
        result: typeof meta.result === "string" ? meta.result : null,
        duration_ms:
          typeof meta.duration_ms === "number"
            ? meta.duration_ms
            : typeof meta.wall_duration_ms === "number"
              ? meta.wall_duration_ms
              : null,
        reservation_count:
          typeof meta.reservation_count === "number" ? meta.reservation_count : null,
        skipped_count: typeof meta.skipped_count === "number" ? meta.skipped_count : null,
        guest_sent_count:
          typeof meta.guest_sent_count === "number" ? meta.guest_sent_count : null,
        heartbeat: typeof meta.heartbeat === "string" ? meta.heartbeat : null,
        duplicate: typeof meta.duplicate === "boolean" ? meta.duplicate : null,
      };
    } else {
      diagnosis.push("job_runs 表存在但尚無 send-line 紀錄（Cron 可能從未成功執行）");
    }
  } else {
    diagnosis.push("job_runs 表未建立 — 無法查 Cron 歷史（執行 migration-job-runs.sql）");
  }

  const { data: branchRows } = await db()
    .from("branches")
    .select("name, line_group_id")
    .order("name");

  const branches =
    branchRows?.map((b) => ({
      name: b.name as string,
      has_line_group_id: Boolean(b.line_group_id),
      line_group_id_prefix: b.line_group_id
        ? String(b.line_group_id).slice(0, 6) + "…"
        : null,
    })) ?? [];

  const multiBranch = branches.some((b) => b.has_line_group_id);
  if (multiBranch) {
    const without = branches.filter((b) => !b.has_line_group_id).map((b) => b.name);
    if (without.length) {
      diagnosis.push(`多分店模式：${without.join("、")} 未設 line_group_id，該店訂位會 fallback LINE_GROUP_ID`);
    }
  } else {
    diagnosis.push("Legacy 模式（無 line_group_id）— 使用環境變數 LINE_GROUP_ID 推群組");
  }

  const { data: tomorrowRows } = await db()
    .from("reservations")
    .select("id, is_notified")
    .gte("start_time", range.start)
    .lte("start_time", range.end)
    .neq("status", "cancelled");

  const total = tomorrowRows?.length ?? 0;
  const pending = tomorrowRows?.filter((r) => !r.is_notified).length ?? 0;
  const notified = total - pending;

  if (total === 0) {
    diagnosis.push(`${range.date} 無有效訂位 — 20:00 Cron 應發貓咪訊息（若 sendCatOnEmpty）`);
  } else if (pending === 0) {
    diagnosis.push(
      `${range.date} 有 ${total} 筆訂位但全部 is_notified=true — Cron 會推「皆已通知過」狀態（不重送 digest）`
    );
  } else {
    diagnosis.push(`${range.date} 有 ${pending} 筆待通知 — 下次 Cron 應推播`);
  }

  // Hobby: UTC 12:00 cron may fire anytime 20:00–20:59 Taipei
  diagnosis.push(
    "Vercel Hobby：排程 20:00 可能延遲至 20:59 才觸發；若 21:00 後仍無訊息再查 job_runs / LINE"
  );

  if (lastSendLine?.status === "failed") {
    diagnosis.push(`上次 send-line 失敗：${lastSendLine.error_message ?? "unknown"}`);
  } else if (lastSendLine?.status === "completed" && lastSendLine.sent === 0 && pending > 0) {
    diagnosis.push("上次 Cron 完成但 sent=0，仍有待通知訂位 — 檢查 line_group_id 或 branch 配對");
  }

  if (!isLineConfigured() && !multiBranch) {
    diagnosis.push("LINE_CHANNEL_ACCESS_TOKEN 或 LINE_GROUP_ID 未設定 — 群組推播無法運作");
  }

  return {
    checked_at: now.toISOString(),
    line_configured: isLineConfigured(),
    job_runs_ready: jobRunsReady,
    last_send_line: lastSendLine,
    branches,
    multi_branch_mode: multiBranch,
    tomorrow: {
      date: range.date,
      total_active: total,
      pending_notify: pending,
      already_notified: notified,
    },
    diagnosis,
  };
}
