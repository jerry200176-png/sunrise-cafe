"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { responseError, thrownMessage } from "@/lib/friendly-error";
import type { Branch } from "@/types";
import type { BusinessSummary } from "@/lib/business-metrics";

type Part = BusinessSummary & { label: string };
type Overview = { this_month: Part; last_month: Part };

const nt = (n: number) => `NT$${n.toLocaleString("zh-TW")}`;

function Row({ label, hint, now, before }: { label: string; hint?: string; now: string; before: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 border-t border-stone-100 py-3 first:border-t-0">
      <div>
        <p className="text-sm font-medium text-stone-800">{label}</p>
        {hint && <p className="text-xs text-stone-500">{hint}</p>}
      </div>
      <p className="min-w-[5.5rem] text-right text-lg font-semibold tabular-nums text-stone-900">{now}</p>
      <p className="min-w-[5.5rem] text-right text-sm tabular-nums text-stone-400">{before}</p>
    </div>
  );
}

export default function ExecutivePage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => setBranches(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/overview${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`, { cache: "no-store" });
      if (!res.ok) {
        setError(await responseError(res));
        return;
      }
      setData(await res.json());
    } catch (err) {
      setError(thrownMessage(err, "暫時讀不到經營數字，請重試"));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const a = data?.this_month;
  const b = data?.last_month;
  const pct = (p: Part | undefined) => (p?.deposit_rate == null ? "—" : `${Math.round(p.deposit_rate * 100)}%`);

  return (
    <AdminShell
      title="經營總覽"
      subtitle={a ? `${a.label}和 ${b?.label}` : "營收、來客數、訂位數"}
      maxWidth="3xl"
      actions={
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          aria-label="分店"
          className="h-11 rounded-xl border border-stone-200 bg-white px-3 text-sm"
        >
          <option value="">全部分店</option>
          {branches.map((br) => (
            <option key={br.id} value={br.id}>{br.name}</option>
          ))}
        </select>
      }
    >
      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}。下面的數字可能不是最新的，不代表沒有生意。
          <button type="button" onClick={() => void load()} className="ml-2 underline">重試</button>
        </div>
      )}

      {!data && loading && <div className="h-64 animate-pulse rounded-2xl bg-stone-200/80" aria-busy="true" aria-label="載入經營總覽" />}

      {a && b && (
        <div className="space-y-5">
          <section aria-label="已收到的錢" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200/80">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 pb-2">
              <h2 className="text-sm font-semibold text-stone-700">已收到的錢</h2>
              <span className="min-w-[5.5rem] text-right text-xs font-medium text-stone-700">{a.label}</span>
              <span className="min-w-[5.5rem] text-right text-xs text-stone-400">{b.label}</span>
            </div>
            <Row label="訂金" hint="已確認收款的訂位訂金" now={nt(a.received_deposits)} before={nt(b.received_deposits)} />
            <Row label="現場與訂位點餐" hint="已結帳的餐點" now={nt(a.received_orders)} before={nt(b.received_orders)} />
          </section>

          <section aria-label="預計的錢" className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-4">
            <h2 className="pb-1 text-sm font-semibold text-stone-700">預計（還沒收到）</h2>
            <p className="pb-2 text-xs text-stone-500">還沒到的訂位金額，客人可能取消，不要當成收入。</p>
            <Row label="還沒到的訂位" now={nt(a.expected_upcoming)} before={nt(b.expected_upcoming)} />
            <Row label="其中訂金還沒收" now={nt(a.unpaid_deposits)} before={nt(b.unpaid_deposits)} />
          </section>

          <section aria-label="來客與訂位" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200/80">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 pb-2">
              <h2 className="text-sm font-semibold text-stone-700">來客與訂位</h2>
              <span className="min-w-[5.5rem] text-right text-xs font-medium text-stone-700">{a.label}</span>
              <span className="min-w-[5.5rem] text-right text-xs text-stone-400">{b.label}</span>
            </div>
            <Row label="訂位數" hint="不含已取消" now={`${a.bookings}`} before={`${b.bookings}`} />
            <Row label="預計來客數" hint="訂位人數加總" now={`${a.guests}`} before={`${b.guests}`} />
            <Row label="已取消" now={`${a.cancelled}`} before={`${b.cancelled}`} />
            <Row label="訂金收款率" hint={`${a.deposit_paid_count} / ${a.bookings} 筆訂位已付訂金`} now={pct(a)} before={pct(b)} />
          </section>
        </div>
      )}
    </AdminShell>
  );
}
