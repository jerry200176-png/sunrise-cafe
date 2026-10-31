"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Clock,
  DollarSign,
  Phone,
  RefreshCw,
  Users,
  AlertTriangle,
} from "lucide-react";
import { friendlyMessage } from "@/lib/friendly-error";
import { waitlistStatusLabel } from "@/lib/status-labels";
import { AdminShell } from "@/components/admin/AdminShell";
import { useAdminBranches } from "@/lib/use-admin-branches";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";

type TodayBundle = {
  date: string;
  branchId: string;
  generated_at: string;
  timezone?: string;
  window?: { start_iso: string; end_iso: string };
  partial_errors?: Array<{ source: string; message: string }>;
  task_hops?: {
    review_payment: { before: number; after: number };
    call_unpaid: { before: number; after: number };
    call_waitlist: { before: number; after: number };
  };
  summary: {
    today_count: number;
    unpaid_deposit: number;
    pending_payment_reviews: number;
    arriving_soon: number;
    at_risk_deadline: number;
    waitlist_open: number;
    waitlist_needs_call: number;
  };
  upcoming: Array<{
    id: string;
    booking_code: string | null;
    customer_name: string;
    phone: string;
    room_name: string;
    start_time: string;
    end_time: string;
    status: string;
    is_deposit_paid: boolean;
    guest_confirmed_at: string | null;
    hours_until_start: number;
  }>;
  unpaid: Array<{
    id: string;
    booking_code: string | null;
    customer_name: string;
    phone: string;
    start_time: string;
    deposit_deadline: string | null;
    hours_to_deadline: number | null;
  }>;
  payment_reviews: Array<{ id: string; reservation_id?: string }>;
  waitlist: Array<{
    id: string;
    customer_name: string;
    phone: string;
    start_time: string;
    status: string;
    line_user_id: string | null;
    staff_called_at: string | null;
  }>;
};

function telHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : `tel:${phone}`;
}

function reservationManagementHref(branchId: string, reservationId: string) {
  if (!branchId || !reservationId) return "/admin";
  return `/admin?branchId=${encodeURIComponent(branchId)}&reservation=${encodeURIComponent(reservationId)}`;
}

const PARTIAL_LABELS: Record<string, string> = {
  payment_events: "付款審核資料暫時讀不到",
  timeline: "今日行程暫時讀不到",
  waitlist: "等位資料暫時讀不到",
};

function fmtDateLabel(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const wd = "日一二三四五六"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}（週${wd}）`;
}

function fmtTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function AdminTodayPage() {
  const { branches, loading: branchesLoading, error: branchesError, retry: retryBranches } = useAdminBranches();
  const [branchId, setBranchId] = useState<string>("");
  const [data, setData] = useState<TodayBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (branches.length && !branchId) setBranchId(branches[0].id);
    if (!branchesLoading && (branchesError || branches.length === 0)) setLoading(false);
  }, [branches, branchId, branchesLoading, branchesError]);

  const load = useCallback(() => {
    if (!branchId) return;
    const seq = ++requestSeq.current;
    const requestedBranch = branchId;
    setLoading(true);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetchWithTimeout(`/api/admin/today?branchId=${encodeURIComponent(requestedBranch)}`, {
          credentials: "include",
        });
        const json = await readJsonWithTimeout<TodayBundle & { error?: string }>(res);
        if (!res.ok) throw new Error(friendlyMessage(json.error, res.status));
        if (seq !== requestSeq.current) return;
        setData(json as TodayBundle);
        setUpdatedAt(fmtTime(new Date().toISOString()));
      } catch (e) {
        // 自動更新失敗時保留原本的資料，只顯示錯誤
        if (seq === requestSeq.current) setError(e instanceof Error ? e.message : "載入失敗，請重試");
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    });
  }, [branchId]);

  useEffect(() => {
    load();
    // 尖峰時段不用手動按重新整理：每 60 秒自動更新（分頁在背景時不打 API）
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const s = data?.summary;
  const subtitle = loading && !data
    ? "載入中…"
    : data?.date
      ? `${fmtDateLabel(data.date)}${updatedAt ? ` · 更新於 ${updatedAt}` : ""}`
      : "今天的訂位與待辦";

  return (
    <AdminShell
      title="今日場控"
      subtitle={subtitle}
      maxWidth="lg"
      actions={
        <button
          type="button"
          onClick={load}
          disabled={loading || pending}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-500 transition-[background-color] duration-200 hover:bg-stone-100 disabled:opacity-50"
          aria-label="重新整理"
        >
          <RefreshCw className={`h-5 w-5 ${loading || pending ? "animate-spin" : ""}`} strokeWidth={1.5} />
        </button>
      }
      headerExtra={
        branches.length > 1 ? (
          <select
            className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm transition-[border-color] duration-200 focus:border-amber-500 focus:outline-none"
            value={branchId}
            onChange={(e) => {
              requestSeq.current++;
              setData(null);
              setUpdatedAt(null);
              setBranchId(e.target.value);
            }}
            aria-label="分店"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
        {branchesError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
          無法載入分店：{branchesError} <button type="button" className="ml-2 underline" onClick={() => void retryBranches()}>重試</button>
        </div>}
        {!branchesLoading && !branchesError && branches.length === 0 && <p role="status" className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600">目前沒有可管理的分店。</p>}
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800" role="alert">
            {error}
            <button type="button" className="ml-2 underline" onClick={load}>
              重試
            </button>
          </div>
        )}

        {!!data?.partial_errors?.length && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900" role="status">
            部分資料暫時無法載入（其餘區塊仍可用）：
            <ul className="mt-1 list-disc pl-5">
              {data.partial_errors.map((e) => (
                <li key={`${e.source}-${e.message}`}>{PARTIAL_LABELS[e.source] ?? "部分資料暫時讀不到"}</li>
              ))}
            </ul>
            <button type="button" className="mt-2 underline" onClick={load}>
              重試全部
            </button>
          </div>
        )}

        {loading && !data && (
          <div className="space-y-3" aria-busy="true" aria-label="載入今日場控">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-stone-200" />
            ))}
          </div>
        )}

        <div className="space-y-4">
        {s && (
          <section aria-label="今日摘要" className="grid grid-cols-2 gap-2">
            {[
              { label: "今日訂位", value: s.today_count, icon: Users },
              { label: "兩小時內", value: s.arriving_soon, icon: Clock },
              { label: "未付訂金", value: s.unpaid_deposit, icon: DollarSign },
              { label: "待審核", value: s.pending_payment_reviews, icon: AlertTriangle },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-stone-200/80">
                <div className="flex items-center gap-2 text-xs text-stone-500">
                  <c.icon className="h-3.5 w-3.5 text-amber-700" strokeWidth={1.5} />
                  {c.label}
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-stone-900">{c.value}</p>
              </div>
            ))}
          </section>
        )}

        <section className="flex flex-wrap gap-2">
          <Link
            href="/admin/payments"
            className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-[background-color] duration-200 hover:bg-amber-700"
          >
            付款審核 {s ? `(${s.pending_payment_reviews})` : ""}
          </Link>
          <Link
            href="/admin/waitlist"
            className="rounded-full bg-stone-800 px-3 py-1.5 text-xs font-medium text-white transition-[background-color] duration-200 hover:bg-stone-700"
          >
            等位 {s ? `(${s.waitlist_open})` : ""}
          </Link>
          <Link
            href="/admin#reservations"
            className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium transition-[border-color,background-color] duration-200 hover:border-amber-300"
          >
            訂位列表
          </Link>
        </section>

        <section aria-label="即將到店" className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-stone-200/80">
          <h2 className="mb-2 text-sm font-semibold text-stone-800">即將到店 / 今日行程</h2>
          {data && !data.upcoming?.length && !loading && (
            <p className="text-sm text-stone-500">今日尚無訂位</p>
          )}
          <ul className="divide-y divide-stone-100">
            {data?.upcoming.map((r) => (
              <li key={r.id} className="flex items-start gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {fmtTime(r.start_time)} · {r.room_name}
                  </p>
                  <p className="truncate text-xs text-stone-600">
                    {r.customer_name}
                    {r.booking_code ? ` · ${r.booking_code}` : ""}
                    {r.is_deposit_paid ? " · 訂金已付" : " · 訂金未付"}
                    {r.guest_confirmed_at ? " · 已確認出席" : ""}
                  </p>
                  <p className="text-xs tabular-nums text-stone-400">
                    {r.hours_until_start >= 0
                      ? `${r.hours_until_start} 小時後`
                      : `已過 ${Math.abs(r.hours_until_start)} 小時`}
                  </p>
                </div>
                <Link
                  href={reservationManagementHref(branchId, r.id)}
                  className="inline-flex shrink-0 items-center rounded-xl border border-stone-300 bg-white min-h-[44px] items-center px-3 py-2 text-xs font-medium text-stone-700 transition-[background-color] duration-200 hover:bg-amber-50"
                >
                  管理
                </Link>
                <a
                  href={telHref(r.phone)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-stone-100 min-h-[44px] items-center px-3 py-2 text-xs font-medium transition-[background-color] duration-200 hover:bg-amber-50"
                >
                  <Phone className="h-3.5 w-3.5" strokeWidth={1.5} />
                  撥打
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="未付與逾期風險" className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-stone-200/80">
          <h2 className="mb-2 text-sm font-semibold text-stone-800">未付訂金 / 逾期風險</h2>
          {data && !data.unpaid?.length && !loading && (
            <p className="text-sm text-stone-500">目前沒有未付訂金的今日訂位</p>
          )}
          <ul className="divide-y divide-stone-100">
            {data?.unpaid.map((r) => (
              <li key={r.id} className="flex items-start gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.customer_name}</p>
                  <p className="text-xs text-stone-600">
                    {fmtTime(r.start_time)}
                    {r.hours_to_deadline != null && (
                      <span
                        className={
                          r.hours_to_deadline <= 6 ? " ml-1 font-medium text-rose-600" : " ml-1"
                        }
                      >
                        · 期限剩 {r.hours_to_deadline}h
                      </span>
                    )}
                  </p>
                </div>
                <Link
                  href={reservationManagementHref(branchId, r.id)}
                  className="inline-flex rounded-xl border border-stone-300 bg-white min-h-[44px] items-center px-3 py-2 text-xs font-medium text-stone-700 transition-[background-color] duration-200 hover:bg-amber-50"
                >
                  管理
                </Link>
                <a href={telHref(r.phone)} className="inline-flex rounded-xl bg-amber-50 min-h-[44px] items-center px-3 py-2 text-xs text-amber-800 transition-[background-color] duration-200 hover:bg-amber-100">
                  電話催訂金
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="等位" className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-stone-200/80">
          <h2 className="mb-2 text-sm font-semibold text-stone-800">等位待處理</h2>
          {data && !data.waitlist?.length && !loading && (
            <p className="text-sm text-stone-500">目前沒有等位</p>
          )}
          <ul className="divide-y divide-stone-100">
            {data?.waitlist.map((w) => (
              <li key={w.id} className="flex items-start gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{w.customer_name}</p>
                  <p className="text-xs text-stone-600">
                    {fmtTime(w.start_time)} · {waitlistStatusLabel(w.status)}
                    {!w.line_user_id ? " · 需人工致電" : " · 有 LINE"}
                  </p>
                </div>
                <a href={telHref(w.phone)} className="rounded-xl bg-stone-100 min-h-[44px] items-center px-3 py-2 text-xs transition-[background-color] duration-200 hover:bg-stone-200">
                  <Phone className="h-3.5 w-3.5" strokeWidth={1.5} />
                </a>
              </li>
            ))}
          </ul>
        </section>
        </div>
    </AdminShell>
  );
}
