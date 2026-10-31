"use client";

import type { PendingOrderAdd } from "@/lib/use-order-add-recovery";

/** Never silently reissue a mutation whose result may already have committed. */
export function OrderAddRecovery({ pending, storageError, busy, onCheck, onCancel }: {
  pending: PendingOrderAdd[]; storageError: string; busy: boolean;
  onCheck: (request: PendingOrderAdd) => void; onCancel: (request: PendingOrderAdd) => void;
}) {
  if (!pending.length && !storageError) return null;
  return <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
    {storageError && <p>{storageError}</p>}
    {pending.length > 0 && <>
      <p>有 {pending.length} 筆加點結果待確認。請先查詢結果；此裝置只保存識別碼，不保存餐點內容。登出後仍會保留識別碼，直到確認或安全取消。</p>
      <ul className="mt-2 space-y-2">{pending.map((request) => <li key={request.key} className="rounded-lg bg-white p-2">
        <p>待確認的加點</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy || Boolean(storageError)} onClick={() => onCheck(request)} className="min-h-11 rounded-lg bg-amber-700 px-3 font-medium text-white disabled:opacity-50">查詢加點結果</button>
          <button type="button" disabled={busy || Boolean(storageError)} onClick={() => onCancel(request)} className="min-h-11 rounded-lg border border-amber-700 px-3 disabled:opacity-50">安全取消未完成的加點</button>
        </div>
      </li>)}</ul>
    </>}
  </div>;
}
