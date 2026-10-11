"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CATEGORY_LABELS, type AdviceResult, type Suggestion } from "@/lib/business-advice";
import { responseError, thrownMessage } from "@/lib/friendly-error";

const nt = (n: number) => `NT$${Math.round(n).toLocaleString("zh-TW")}`;

function Card({ s, onDecide, busy }: { s: Suggestion; onDecide: (id: string, d: "adopted" | "skipped") => void; busy: boolean }) {
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-stone-900">{s.title}</p>
        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{CATEGORY_LABELS[s.category]}</span>
      </div>
      <p className="mt-1 text-sm text-stone-600">{s.why}</p>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {s.numbers.map((n) => (
          <div key={n.label} className="flex justify-between gap-2"><dt className="text-stone-500">{n.label}</dt><dd className="tabular-nums text-stone-900">{n.value}</dd></div>
        ))}
      </dl>
      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
        <span className="text-stone-500">估計影響（近 4 週，粗估）<strong className="ml-1 text-stone-900">{nt(s.impactNt)}</strong></span>
        <Link href={s.href} className="font-medium text-amber-800 underline">去設定頁看看</Link>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={() => onDecide(s.id, "adopted")} className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">採用</button>
        <button type="button" disabled={busy} onClick={() => onDecide(s.id, "skipped")} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 disabled:opacity-50">略過</button>
      </div>
    </li>
  );
}

/** 建議決策。分店範圍由上層的分店選單決定（和經營總覽數字同一個 branchId）。 */
export function AdvicePanel({ branchId }: { branchId: string }) {
  const [advice, setAdvice] = useState<AdviceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  async function decide(suggestionId: string, decision: "adopted" | "skipped") {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/advice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ suggestionId, decision }) });
      if (!res.ok) throw new Error(await responseError(res));
      setReload((n) => n + 1);
    } catch (e) {
      setError(thrownMessage(e, "沒有記錄成功，請重試"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let live = true;
    setError(null);
    setShowMore(false);
    fetch(`/api/admin/advice${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await responseError(res));
        return res.json() as Promise<AdviceResult>;
      })
      .then((d) => live && setAdvice(d))
      .catch((e) => live && setError(thrownMessage(e, "暫時讀不到建議")));
    return () => { live = false; };
  }, [branchId, reload]);

  return (
    <section aria-label="建議決策" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200/80">
      <h2 className="text-sm font-semibold text-stone-700">建議決策</h2>
      <p className="pb-3 text-xs text-stone-500">依近 4 週的訂位數字整理，系統不會自動改任何設定。</p>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {!advice && !error && <div className="h-24 animate-pulse rounded-xl bg-stone-100" aria-busy="true" />}
      {advice && !advice.enough && (
        <p className="rounded-xl bg-stone-50 p-4 text-sm text-stone-700">資料還不夠，再累積 {advice.weeksToWait} 週（需要至少 4 週、20 筆訂位）。</p>
      )}
      {advice?.enough && advice.top.length === 0 && <p className="text-sm text-stone-600">目前沒有需要特別處理的地方。</p>}
      {advice?.enough && (
        <>
          <ul className="space-y-3">{advice.top.map((s) => <Card key={s.id} s={s} onDecide={decide} busy={busy} />)}</ul>
          {advice.more.length > 0 && (
            <>
              <button type="button" onClick={() => setShowMore((v) => !v)} className="mt-3 text-sm font-medium text-amber-800 underline">
                {showMore ? "收起" : `看更多（${advice.more.length}）`}
              </button>
              {showMore && <ul className="mt-3 space-y-3">{advice.more.map((s) => <Card key={s.id} s={s} onDecide={decide} busy={busy} />)}</ul>}
            </>
          )}
          {advice.adopted && advice.adopted.length > 0 && (
            <div className="mt-5 border-t border-stone-100 pt-4">
              <h3 className="text-sm font-semibold text-stone-700">已採用的建議</h3>
              <ul className="mt-2 space-y-3">
                {advice.adopted.map((a) => (
                  <li key={a.suggestionId} className="rounded-xl bg-stone-50 p-3 text-sm">
                    <p className="font-medium text-stone-900">{a.title}</p>
                    <p className="mt-1 text-stone-600">採用時：{a.before.map((n) => `${n.label} ${n.value}`).join("、")}</p>
                    {a.after === null ? (
                      <p className="text-stone-500">還要 {a.daysLeft} 天才能比較前後。</p>
                    ) : a.after.resolved ? (
                      <p className="text-emerald-800">4 週後：這項已經不需要處理了。</p>
                    ) : (
                      <p className="text-stone-700">4 週後：{a.after.numbers.map((n) => `${n.label} ${n.value}`).join("、")}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
