"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdvicePanel } from "@/components/admin/AdvicePanel";
import { responseError, thrownMessage } from "@/lib/friendly-error";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { useAdminBranches } from "@/lib/use-admin-branches";
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
  const { branches, loading: branchesLoading, error: branchesError, retry: retryBranches } = useAdminBranches();
  const branchScopeKey = JSON.stringify(branches.map((branch) => branch.id).sort());
  const [branchId, setBranchId] = useState("");
  const branchUnavailable = !branchesLoading && !branchesError && Boolean(branchId) && !branches.some((branch) => branch.id === branchId);
  const queryKey = JSON.stringify([branchId, branchScopeKey]);
  const [data, setData] = useState<Overview | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);
  const invalidateRequests = useCallback(() => { requestSequence.current++; }, []);

  useEffect(() => {
    if (branchUnavailable) setBranchId("");
  }, [branchUnavailable]);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout(`/api/admin/overview${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(await responseError(res));
      }
      const result = await readJsonWithTimeout<Overview>(res);
      if (requestId !== requestSequence.current) return;
      setData(result);
      setLoadedKey(queryKey);
    } catch (err) {
      if (requestId === requestSequence.current) setError(thrownMessage(err, "暫時讀不到經營數字，請重試"));
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [branchId, queryKey]);

  useEffect(() => {
    if (!branchUnavailable) void load();
    return invalidateRequests;
  }, [load, invalidateRequests, branchUnavailable]);

  const visibleData = !branchUnavailable && loadedKey === queryKey ? data : null;
  const a = visibleData?.this_month;
  const b = visibleData?.last_month;
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
          {branchesLoading && <option disabled value="__loading">載入分店…</option>}
          {branches.map((br) => (
            <option key={br.id} value={br.id}>{br.name}</option>
          ))}
        </select>
      }
    >
      {branchesError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>{branchesError}</span>
          <button type="button" onClick={() => void retryBranches()} className="underline">重試載入分店</button>
        </div>
      )}
      {!branchesLoading && !branchesError && branches.length === 0 && (
        <p role="status" className="mb-4 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-600">目前沒有可選的分店；總覽仍依帳號權限顯示。</p>
      )}
      {!branchUnavailable && <div className="mb-5"><AdvicePanel key={queryKey} branchId={branchId} /></div>}

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}。下面的數字可能不是最新的，不代表沒有生意。
          <button type="button" onClick={() => void load()} className="ml-2 underline">重試</button>
        </div>
      )}

      {!visibleData && loading && <div className="h-64 animate-pulse rounded-2xl bg-stone-200/80" aria-busy="true" aria-label="載入經營總覽" />}

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
