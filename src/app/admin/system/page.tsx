"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCw,
  TrendingUp,
  Wallet,
  CalendarDays,
  XCircle,
  Server,
  Bell,
  Database,
  Headphones,
  ListTodo,
  GitBranch,
  type LucideIcon,
} from "lucide-react";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { responseError, thrownMessage } from "@/lib/friendly-error";

type OutcomeSnapshot = {
  collected_at: string;
  status: "ok" | "degraded" | "unavailable";
  health_block: {
    date: string;
    deposit_rate_pct: number | null;
    waitlist_conversion_pct: number | null;
    payment_review_oldest_hours: number | null;
    payment_review_sla_breached?: boolean;
    migrations_all_applied: string;
    overlap_constraint_active: string;
  };
  booking: {
    bookings_30d: number;
    bookings_7d: number;
    cancellation_rate_30d: number | null;
    cancellation_count_30d: number;
  };
  payment: {
    deposit_rate_pct: number | null;
    pending_reviews: number;
    payment_review_oldest_hours: number | null;
    deposit_at_risk: number;
    payment_events_ready: boolean;
  };
  cancellation: { cancelled_30d: number; auto_release_proxy_7d: number };
  waitlist: { joined_30d: number; converted_30d: number; conversion_pct: number | null };
  cron: {
    deposit_reminders_7d: number;
    tomorrow_reminders_pending: number;
    auto_releases_7d: number;
    job_runs_ready: boolean;
    jobs: {
      job_name: string;
      last_status: string;
      runs_7d: number;
      failed_7d: number;
      last_items_processed: number;
    }[];
  };
  deployment: {
    commit: string | null;
    live_commit_short: string | null;
    repository_commit: string | null;
    sha_parity: boolean | null;
    production_reachable: boolean;
    health_ok: boolean;
  };
  migrations: {
    all_required_applied: boolean;
    pending: string[];
    overlap_constraint_active: boolean;
    closed_dates_column: boolean;
  };
  support: { pending_payment_reviews: number; rejected_events_7d: number };
  funnel: {
    ops_events_ready: boolean;
    booking_flow_entered_7d: number;
    booking_created_7d: number;
    booking_conversion_pct: number | null;
    deposit_instructions_viewed_7d: number;
    payment_clicks_7d: number;
    payment_completion_pct: number | null;
    payment_approved_7d: number;
    payment_approved_keyboard_7d: number;
    keyboard_adoption_pct: number | null;
  };
};

type OrchestratorWall = {
  status: string;
  iteration_count: number;
  operational_mode: string;
  gate_block: boolean;
  next_task: { id: string; title: string; score: number; role: string } | null;
  ranked_executable: { id: string; title: string; score: number; role: string }[];
  stall: { stalled: boolean; warnings: { code: string; message: string }[] };
  recent_learnings: { phase: string; task_id: string; antibody: string }[];
};

type NorthStarSnapshot = {
  measured_count: number;
  unmeasured_count: number;
  metrics: {
    id: string;
    name: string;
    observed: number | null;
    value: number | null;
    unit: string;
    target: number;
    delta: number | null;
    status: string;
  }[];
};

function Metric({
  icon: Icon,
  label,
  value,
  sub,
  alert,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  alert?: boolean;
  href?: string;
}) {
  const inner = (
    <>
      <div className="mb-2 flex items-center gap-2 text-stone-500">
        <Icon size={16} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${alert ? "text-amber-800" : "text-stone-800"}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-stone-500">{sub}</p>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`block rounded-2xl border p-4 transition hover:border-amber-300 ${
          alert ? "border-amber-200 bg-amber-50/50" : "border-stone-200 bg-white"
        }`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={`rounded-2xl border p-4 ${
        alert ? "border-amber-200 bg-amber-50/50" : "border-stone-200 bg-white"
      }`}
    >
      {inner}
    </div>
  );
}

function pct(v: number | null, target?: number) {
  if (v == null) return "—";
  const s = `${v}%`;
  if (target == null) return s;
  return v >= target ? s : `${s} (目標 ${target}%)`;
}

export default function ExecutiveDashboardPage() {
  const [data, setData] = useState<OutcomeSnapshot | null>(null);
  const [northStar, setNorthStar] = useState<NorthStarSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [orchestrator, setOrchestrator] = useState<OrchestratorWall | null>(null);
  const [supplementalError, setSupplementalError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    setSupplementalError(null);
    setData(null);
    setNorthStar(null);
    setOrchestrator(null);
    try {
      const res = await fetchWithTimeout("/api/admin/outcomes", { cache: "no-store" });
      if (sequence !== loadSequence.current) return;
      if (!res.ok) {
        if (res.status === 403) throw new Error("您的帳號不能看這一頁，請找工程人員");
        throw new Error(await responseError(res));
      }
      const json = await readJsonWithTimeout<OutcomeSnapshot>(res);
      if (sequence !== loadSequence.current) return;
      setData(json);
      setLoading(false);

      // These panels are supplemental. Load them concurrently and independently so
      // one slow endpoint cannot keep the primary system status behind a spinner.
      const [nsResult, orchResult] = await Promise.allSettled([
        fetchWithTimeout("/api/admin/north-star", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error(await responseError(response));
          return readJsonWithTimeout<NorthStarSnapshot>(response);
        }),
        fetchWithTimeout("/api/admin/orchestrator", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error(await responseError(response));
          return readJsonWithTimeout<OrchestratorWall>(response);
        }),
      ]);
      if (sequence !== loadSequence.current) return;
      const partialErrors: string[] = [];
      if (nsResult.status === "fulfilled") setNorthStar(nsResult.value);
      else partialErrors.push(thrownMessage(nsResult.reason));
      if (orchResult.status === "fulfilled") setOrchestrator(orchResult.value);
      else partialErrors.push(thrownMessage(orchResult.reason));
      setSupplementalError(partialErrors.length ? "部分系統狀態資料暫時無法取得，主要狀態仍可使用。" : null);
    } catch (e) {
      if (sequence === loadSequence.current) {
        setError(thrownMessage(e, "系統狀態載入失敗，請重新整理"));
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const depositLow =
    data?.payment.deposit_rate_pct != null && data.payment.deposit_rate_pct < 75;
  const reviewBacklog = (data?.payment.pending_reviews ?? 0) > 0;
  const reviewSla =
    data?.health_block.payment_review_sla_breached === true ||
    (data?.payment.payment_review_oldest_hours != null &&
      data.payment.payment_review_oldest_hours > 4);
  const deployDrift = data?.deployment.sha_parity === false;
  const migrationsPending = data?.migrations.all_required_applied === false;

  const topRisks: string[] = [];
  if (deployDrift) topRisks.push("Production 落後 repository — 客戶未收到最新修正");
  if (migrationsPending) topRisks.push("DB migrations 未套用 — 雙重訂位風險");
  if (reviewSla) topRisks.push("付款審核超過 4 小時 SLA");
  if (depositLow) topRisks.push("訂金率低於 75% 目標");
  if (
    data?.funnel.ops_events_ready &&
    data.funnel.payment_completion_pct != null &&
    data.funnel.payment_completion_pct < 40 &&
    data.funnel.deposit_instructions_viewed_7d >= 5
  ) {
    topRisks.push("付款 CTA 點擊率偏低（7d）— 檢視查詢頁 sticky bar");
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-stone-400 hover:text-stone-600">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-stone-800">系統狀態（工程用）</h1>
              <p className="text-xs text-stone-500">
                部署、資料庫與排程狀態。店務請看「經營總覽」
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            重新整理
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {supplementalError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            {supplementalError}
          </div>
        )}

        {data && (
          <>
            {topRisks.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
                <p className="text-sm font-semibold text-amber-900">營運風險（需處理）</p>
                <ul className="mt-2 list-disc pl-5 text-sm text-amber-800 space-y-1">
                  {topRisks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.status === "unavailable" && (
              <div
                className="rounded-xl border border-red-300 bg-red-50 px-4 py-3"
                role="alert"
              >
                <p className="text-sm font-semibold text-red-900">
                  Outcome 資料無法取得（unavailable）
                </p>
                <p className="mt-1 text-sm text-red-800">
                  下方數字若為 0 不代表零訂位活動——請勿當成 zero activity。請檢查
                  service role／權限後重新整理。
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-sm text-stone-600">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  data.status === "ok"
                    ? "bg-green-100 text-green-800"
                    : data.status === "degraded"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-red-100 text-red-800"
                }`}
              >
                {data.status}
              </span>
              <span>更新：{new Date(data.collected_at).toLocaleString("zh-TW")}</span>
              {data.deployment.live_commit_short && (
                <span className="font-mono text-xs">
                  線上 SHA {data.deployment.live_commit_short}
                  {data.deployment.sha_parity === false && data.deployment.repository_commit && (
                    <span className="text-amber-700">
                      {" "}
                      ≠ repo {data.deployment.repository_commit}
                    </span>
                  )}
                </span>
              )}
            </div>

            {northStar && (
              <section>
                <h2 className="mb-1 text-sm font-semibold text-stone-700">North Star Metrics</h2>
                <p className="mb-3 text-xs text-stone-500">
                  Hypothesis → Baseline → Measure → Compare · Observed/Target · 已量測{" "}
                  {northStar.measured_count} · 待量測 {northStar.unmeasured_count}
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {northStar.metrics
                    .filter((m) => m.status !== "unmeasured")
                    .slice(0, 6)
                    .map((m) => {
                      const obs = m.observed ?? m.value;
                      return (
                      <div
                        key={m.id}
                        className={`rounded-xl border px-3 py-2 text-sm ${
                          m.status === "on_track"
                            ? "border-green-200 bg-green-50/40"
                            : "border-amber-200 bg-amber-50/40"
                        }`}
                      >
                        <p className="text-xs text-stone-500">{m.name}</p>
                        <p className="font-semibold text-stone-800">
                          {obs != null ? `${obs}${m.unit === "%" ? "%" : ` ${m.unit}`}` : "—"}
                          <span className="ml-1 text-xs font-normal text-stone-500">
                            → {m.target}
                            {m.unit === "%" ? "%" : ` ${m.unit}`}
                          </span>
                        </p>
                        {m.delta != null && (
                          <p className="text-xs text-stone-500">
                            Δ {m.delta > 0 ? "+" : ""}
                            {m.delta}
                            {m.unit === "%" ? "%" : ""} vs target
                          </p>
                        )}
                      </div>
                    );})}
                </div>
                <Link
                  href="/api/admin/executive-review"
                  className="mt-2 inline-block text-xs text-amber-700 hover:underline"
                >
                  Weekly Executive Review JSON →
                </Link>
              </section>
            )}

            <section>
              <h2 className="mb-3 text-sm font-semibold text-stone-700">營收 & 付款</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  icon={Wallet}
                  label="訂金率 (30d)"
                  value={pct(data.payment.deposit_rate_pct, 85)}
                  alert={depositLow}
                />
                <Metric
                  icon={TrendingUp}
                  label="候補轉換 (30d)"
                  value={pct(data.waitlist.conversion_pct, 30)}
                />
                <Metric
                  icon={Headphones}
                  label="待審核付款"
                  value={String(data.payment.pending_reviews)}
                  sub={
                    data.payment.payment_review_oldest_hours != null
                      ? `最舊 ${data.payment.payment_review_oldest_hours}h · 點擊前往審核`
                      : data.payment.pending_reviews > 0
                        ? "點擊前往審核"
                        : undefined
                  }
                  alert={reviewSla || reviewBacklog}
                  href={data.payment.pending_reviews > 0 ? "/admin/payments" : undefined}
                />
                <Metric
                  icon={XCircle}
                  label="訂金逾期風險"
                  value={String(data.payment.deposit_at_risk)}
                  sub="未付訂金 active 訂位"
                  alert={data.payment.deposit_at_risk > 0}
                />
              </div>
            </section>

            <section>
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-stone-700">
                <GitBranch size={16} />
                轉換漏斗 (7d)
              </h2>
              <p className="mb-3 text-xs text-stone-500">
                OPS-004b · ops_events 聚合 · 訂位完成率與付款 CTA 點擊率
              </p>
              {!data.funnel.ops_events_ready ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm text-amber-800">
                  無法確認 ops_events 是否就緒，請管理人員核對資料庫與遷移記錄。
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric
                    icon={GitBranch}
                    label="訂位轉換"
                    value={pct(data.funnel.booking_conversion_pct, 80)}
                    sub={`${data.funnel.booking_created_7d}/${data.funnel.booking_flow_entered_7d} 完成`}
                    alert={
                      data.funnel.booking_conversion_pct != null &&
                      data.funnel.booking_conversion_pct < 70 &&
                      data.funnel.booking_flow_entered_7d >= 10
                    }
                  />
                  <Metric
                    icon={Wallet}
                    label="付款 CTA 點擊率"
                    value={pct(data.funnel.payment_completion_pct, 50)}
                    sub={`${data.funnel.payment_clicks_7d}/${data.funnel.deposit_instructions_viewed_7d} 次點擊`}
                    alert={
                      data.funnel.payment_completion_pct != null &&
                      data.funnel.payment_completion_pct < 40 &&
                      data.funnel.deposit_instructions_viewed_7d >= 5
                    }
                  />
                  <Metric
                    icon={Headphones}
                    label="審核核准 (7d)"
                    value={String(data.funnel.payment_approved_7d)}
                    sub={
                      data.funnel.keyboard_adoption_pct != null
                        ? `鍵盤 ${data.funnel.payment_approved_keyboard_7d} · ${data.funnel.keyboard_adoption_pct}%`
                        : undefined
                    }
                  />
                  <Metric
                    icon={TrendingUp}
                    label="漏斗樣本"
                    value={String(data.funnel.booking_flow_entered_7d)}
                    sub={`${data.funnel.deposit_instructions_viewed_7d} 次查看繳費說明`}
                  />
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-stone-700">訂位 & 取消</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  icon={CalendarDays}
                  label="訂位 (30d)"
                  value={
                    data.status === "unavailable"
                      ? "—"
                      : String(data.booking.bookings_30d)
                  }
                  sub={
                    data.status === "unavailable"
                      ? "資料無法取得"
                      : `本週 ${data.booking.bookings_7d}`
                  }
                />
                <Metric
                  icon={XCircle}
                  label="取消率 (30d)"
                  value={
                    data.booking.cancellation_rate_30d != null
                      ? `${(data.booking.cancellation_rate_30d * 100).toFixed(1)}%`
                      : "—"
                  }
                  sub={`${data.booking.cancellation_count_30d} 筆`}
                />
                <Metric
                  icon={XCircle}
                  label="自動釋放 (7d)"
                  value={String(data.cancellation.auto_release_proxy_7d)}
                  sub="未付訂金取消 proxy"
                />
                <Metric
                  icon={TrendingUp}
                  label="候補 (30d)"
                  value={`${data.waitlist.converted_30d}/${data.waitlist.joined_30d}`}
                />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-stone-700">Cron & 部署</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  icon={Bell}
                  label="訂金提醒 (7d)"
                  value={String(data.cron.deposit_reminders_7d)}
                />
                <Metric
                  icon={Bell}
                  label="明日提醒待送"
                  value={String(data.cron.tomorrow_reminders_pending)}
                  alert={data.cron.tomorrow_reminders_pending > 0}
                />
                <Metric
                  icon={Server}
                  label="部署健康"
                  value={data.deployment.health_ok ? "OK" : "異常"}
                />
                <Metric
                  icon={Database}
                  label="Migrations"
                  value={data.migrations.all_required_applied ? "已同步" : "待套用"}
                  sub={
                    data.migrations.pending.length
                      ? `缺：${data.migrations.pending.join(", ")}`
                      : "overlap + RBAC"
                  }
                  alert={!data.migrations.all_required_applied}
                />
              </div>
              {data.cron.job_runs_ready && data.cron.jobs.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white text-xs">
                  <table className="w-full text-left">
                    <thead className="border-b border-stone-100 text-stone-500">
                      <tr>
                        <th className="px-3 py-2">Cron job</th>
                        <th className="px-3 py-2">上次狀態</th>
                        <th className="px-3 py-2">7d 執行</th>
                        <th className="px-3 py-2">7d 失敗</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.cron.jobs.map((j) => (
                        <tr key={j.job_name} className="border-b border-stone-50">
                          <td className="px-3 py-2 font-mono">{j.job_name}</td>
                          <td className={`px-3 py-2 ${j.last_status === "failed" ? "text-amber-700" : "text-green-700"}`}>
                            {j.last_status || "—"}
                          </td>
                          <td className="px-3 py-2">{j.runs_7d}</td>
                          <td className="px-3 py-2">{j.failed_7d}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!data.cron.job_runs_ready && (
                <p className="mt-2 text-xs text-stone-500">
                  job_runs 表未建立 — 執行 migration-job-runs.sql 後可查 cron 歷史
                </p>
              )}
            </section>

            {orchestrator && (
              <section>
                <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-stone-700">
                  <ListTodo size={16} />
                  Engineering Task Wall
                </h2>
                <p className="mb-3 text-xs text-stone-500">
                  自主工程佇列 · 迭代 #{orchestrator.iteration_count} · {orchestrator.operational_mode}
                  {orchestrator.gate_block && " · Gate BLOCK"}
                </p>
                {orchestrator.stall.stalled && (
                  <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p className="font-semibold">Loop 停滯警告</p>
                    <ul className="mt-1 list-disc pl-4">
                      {orchestrator.stall.warnings.map((w) => (
                        <li key={w.code}>{w.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {orchestrator.next_task ? (
                  <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/40 px-4 py-3">
                    <p className="text-xs text-stone-500">Next task</p>
                    <p className="font-semibold text-stone-800">
                      {orchestrator.next_task.title}
                    </p>
                    <p className="mt-1 font-mono text-xs text-stone-600">
                      {orchestrator.next_task.id} · score {orchestrator.next_task.score} ·{" "}
                      {orchestrator.next_task.role}
                    </p>
                  </div>
                ) : (
                  <p className="mb-3 text-sm text-stone-500">無可執行任務（idle）</p>
                )}
                {orchestrator.ranked_executable.length > 1 && (
                  <ul className="space-y-1 text-xs text-stone-600">
                    {orchestrator.ranked_executable.slice(1, 5).map((t) => (
                      <li key={t.id} className="flex justify-between gap-2 rounded-lg border border-stone-100 bg-white px-3 py-2">
                        <span className="truncate">{t.title}</span>
                        <span className="shrink-0 font-mono text-stone-400">{t.score}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {orchestrator.recent_learnings.length > 0 && (
                  <details className="mt-3 text-xs text-stone-600">
                    <summary className="cursor-pointer text-stone-500">
                      最近失敗學習（{orchestrator.recent_learnings.length}）
                    </summary>
                    <ul className="mt-2 space-y-2">
                      {orchestrator.recent_learnings.map((l, i) => (
                        <li key={`${l.task_id}-${i}`} className="rounded border border-stone-100 bg-stone-50 px-2 py-1">
                          <span className="font-mono text-stone-500">{l.phase}</span> — {l.antibody}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )}

            <section className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
              <p className="font-medium text-stone-800">決策用 — 不需手動更新文件</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
                <li>
                  訂金率 &lt;75% 連續 2 週 → 檢視 Payment SOP，再考慮 #53 工程
                </li>
                <li>待審核 &gt;0 → 今日清 `/admin/payments`</li>
                <li>Migration 待套用 → `OPS_MIGRATION_RUNBOOK.md`</li>
              </ul>
              <p className="mt-3 text-xs text-stone-400">
                API: <code className="rounded bg-stone-100 px-1">GET /api/admin/outcomes</code> ·
                CTO: <code className="rounded bg-stone-100 px-1">npm run cto:outcomes</code>
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
