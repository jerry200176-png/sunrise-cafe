"use client";

import type { AddWarning } from "@/lib/use-add-outcome-warning";

export function AddOutcomeWarning({ warning, onReload, busy }: { warning: AddWarning | undefined; onReload: () => void; busy: boolean }) {
  if (!warning) return null;
  return <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
    <p>{warning === "unknown"
      ? "上次加點結果未確認，原請求可能稍後完成。請先核對訂單並與同事確認，避免重複加點。"
      : "上次加點已完成，但畫面未更新。請重新載入並核對訂單。"}</p>
    <button type="button" disabled={busy} onClick={onReload} className="mt-2 min-h-11 rounded-lg border border-amber-700 px-3 disabled:opacity-50">重新載入訂單</button>
  </div>;
}
