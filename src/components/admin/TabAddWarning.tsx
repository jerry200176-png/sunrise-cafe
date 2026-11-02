"use client";

import type { useTabAddWarning } from "@/lib/use-tab-add-warning";

type Guard = ReturnType<typeof useTabAddWarning>;
export function TabAddWarning({ guard }: { guard: Guard }) {
  const state = guard.state;
  if (!state || (state.available && state.entries.length === 0)) return null;
  const unresolved = state.entries.some((entry) => entry.status !== "committed");
  const committed = state.entries.some((entry) => entry.status === "committed");
  return <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
    {!state.available && <p>無法保存分頁提醒；離開或重新整理後，畫面上的提示可能消失。請先核對訂單。</p>}
    {unresolved && <p>本分頁有尚未確認的加點紀錄，不一定屬於目前訂位；原請求可能稍後完成。請核對所有可能相關訂單並與同事確認。</p>}
    {committed && <p>本分頁有已提交、仍需人工核對的加點，不一定屬於目前訂位。</p>}
    {committed && <button type="button" className="mt-2 underline" onClick={guard.acknowledgeCommitted}>已核對所有可能相關的已提交加點</button>}
    {(unresolved || committed) && <p>此提醒僅在本分頁工作階段保留。</p>}
  </div>;
}
