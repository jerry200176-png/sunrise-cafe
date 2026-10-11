"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CATEGORY_LABELS, type AdviceResult, type Suggestion } from "@/lib/business-advice";
import { responseError, thrownMessage } from "@/lib/friendly-error";

const nt = (n: number) => `NT$${Math.round(n).toLocaleString("zh-TW")}`;

function Card({ s }: { s: Suggestion }) {
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
    </li>
  );
}

/** 建議決策。分店範圍由上層的分店選單決定（和經營總覽數字同一個 branchId）。 */
export function AdvicePanel({ branchId }: { branchId: string }) {
  const [advice, setAdvice] = useState<AdviceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    let live = true;
    setAdvice(null);
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
  }, [branchId]);

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
          <ul className="space-y-3">{advice.top.map((s) => <Card key={s.id} s={s} />)}</ul>
          {advice.more.length > 0 && (
            <>
              <button type="button" onClick={() => setShowMore((v) => !v)} className="mt-3 text-sm font-medium text-amber-800 underline">
                {showMore ? "收起" : `看更多（${advice.more.length}）`}
              </button>
              {showMore && <ul className="mt-3 space-y-3">{advice.more.map((s) => <Card key={s.id} s={s} />)}</ul>}
            </>
          )}
        </>
      )}
    </section>
  );
}
