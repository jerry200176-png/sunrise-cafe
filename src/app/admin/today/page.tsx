"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  DollarSign,
  LogOut,
  Phone,
  RefreshCw,
  Users,
  AlertTriangle,
} from "lucide-react";

type TodayBundle = {
  date: string;
  branchId: string;
  generated_at: string;
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

type Branch = { id: string; name: string };

function telHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : `tel:${phone}`;
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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [data, setData] = useState<TodayBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    fetch("/api/branches", { credentials: "include" })
      .then((r) => r.json())
      .then((rows: Branch[]) => {
        const list = Array.isArray(rows) ? rows : [];
        setBranches(list);
        if (list[0]) setBranchId(list[0].id);
      })
      .catch(() => setError("無法載入分店"));
  }, []);

  const load = useCallback(() => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/today?branchId=${encodeURIComponent(branchId)}`, {
          credentials: "include",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "載入失敗");
        setData(json as TodayBundle);
      } catch (e) {
        setError(e instanceof Error ? e.message : "載入失敗");
        setData(null);
      } finally {
        setLoading(false);
      }
    });
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const s = data?.summary;

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 px-3 py-3 backdrop-blur safe-area-pad">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <Link href="/admin/dashboard" className="rounded-lg p-2 hover:bg-stone-100" aria-label="返回">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight">今日場控</h1>
            <p className="truncate text-xs text-stone-500">{data?.date ?? "—"} · 尖峰一屏完成</p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading || pending}
            className="rounded-lg p-2 hover:bg-stone-100 disabled:opacity-50"
            aria-label="重新整理"
          >
            <RefreshCw className={`h-5 w-5 ${loading || pending ? "animate-spin" : ""}`} />
          </button>
          <Link href="/admin/login" className="rounded-lg p-2 hover:bg-stone-100" aria-label="登出">
            <LogOut className="h-5 w-5" />
          </Link>
        </div>
        {branches.length > 1 && (
          <div className="mx-auto mt-2 max-w-lg">
            <select
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              aria-label="分店"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-3 py-4 pb-24">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800" role="alert">
            {error}
            <button type="button" className="ml-2 underline" onClick={load}>
              重試
            </button>
          </div>
        )}

        {loading && !data && (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-stone-200" />
            ))}
          </div>
        )}

        {s && (
          <section aria-label="今日摘要" className="grid grid-cols-2 gap-2">
            {[
              { label: "今日訂位", value: s.today_count, icon: Users },
              { label: "兩小時內", value: s.arriving_soon, icon: Clock },
              { label: "未付訂金", value: s.unpaid_deposit, icon: DollarSign },
              { label: "待審核", value: s.pending_payment_reviews, icon: AlertTriangle },
            ].map((c) => (
              <div key={c.label} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
                <div className="flex items-center gap-2 text-xs text-stone-500">
                  <c.icon className="h-3.5 w-3.5" />
                  {c.label}
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</p>
              </div>
            ))}
          </section>
        )}

        <section className="flex flex-wrap gap-2">
          <Link
            href="/admin/payments"
            className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-medium text-white"
          >
            付款審核 {s ? `(${s.pending_payment_reviews})` : ""}
          </Link>
          <Link
            href="/admin/waitlist"
            className="rounded-full bg-stone-800 px-3 py-1.5 text-xs font-medium text-white"
          >
            候補 {s ? `(${s.waitlist_open})` : ""}
          </Link>
          <Link
            href="/admin/tables"
            className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium"
          >
            訂位列表
          </Link>
        </section>

        <section aria-label="即將到店" className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
          <h2 className="mb-2 text-sm font-semibold">即將到店 / 今日行程</h2>
          {!data?.upcoming.length && !loading && (
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
                    {r.is_deposit_paid ? " · 已付" : " · 未付"}
                    {r.guest_confirmed_at ? " · 已確認出席" : ""}
                  </p>
                  <p className="text-xs tabular-nums text-stone-400">
                    {r.hours_until_start >= 0
                      ? `${r.hours_until_start}h 後`
                      : `已過 ${Math.abs(r.hours_until_start)}h`}
                  </p>
                </div>
                <a
                  href={telHref(r.phone)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-stone-100 px-2 py-2 text-xs font-medium"
                >
                  <Phone className="h-3.5 w-3.5" />
                  打
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="未付與逾期風險" className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
          <h2 className="mb-2 text-sm font-semibold">未付訂金 / 逾期風險</h2>
          {!data?.unpaid.length && !loading && (
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
                <a href={telHref(r.phone)} className="rounded-lg bg-amber-50 px-2 py-2 text-xs text-amber-800">
                  催繳
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="候補" className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
          <h2 className="mb-2 text-sm font-semibold">候補待處理</h2>
          {!data?.waitlist.length && !loading && (
            <p className="text-sm text-stone-500">目前無候補</p>
          )}
          <ul className="divide-y divide-stone-100">
            {data?.waitlist.map((w) => (
              <li key={w.id} className="flex items-start gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{w.customer_name}</p>
                  <p className="text-xs text-stone-600">
                    {fmtTime(w.start_time)} · {w.status}
                    {!w.line_user_id ? " · 需人工致電" : " · 有 LINE"}
                  </p>
                </div>
                <a href={telHref(w.phone)} className="rounded-lg bg-stone-100 px-2 py-2 text-xs">
                  <Phone className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
