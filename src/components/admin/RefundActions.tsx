"use client";

import { useState } from "react";
import { friendlyMessage, thrownMessage } from "@/lib/friendly-error";
import { REFUND_ACTION_STATUS, manualRefundProblem, refundActionsFor, type RefundAction } from "@/lib/refund-actions";
import { settlementFailure } from "@/lib/room-settlement";

export type RefundRowLike = { id: string; method: string; status: string; amount: number };

const ACTION_LABEL: Record<RefundAction, string> = {
  pending: "已送出，等入帳",
  confirm: "確認已退",
  fail: "標記失敗",
  cancel: "取消退款",
  reconcile: "向 Stripe 對帳",
};

/**
 * 一筆退款的處理按鈕（Founder D7）。
 * - 確認已退：非現金要填轉帳序號／交易編號＋說明；現金要寫說明。不能為了解除「處理中」就直接標成功
 * - 標記失敗、取消退款：要寫原因
 * - Stripe 退款：只能「向 Stripe 對帳」，結果由 Stripe 決定（含取消）
 * 每一步都由 API 寫成帳本上一列只能新增的事件；權限（老闆／本分店店長）由 API 與 SQL 檢查。
 */
export function RefundActions({ refund, onDone }: { refund: RefundRowLike; onDone: () => void }) {
  const [open, setOpen] = useState<Exclude<RefundAction, "reconcile" | "pending"> | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const actions = refundActionsFor(refund);
  if (!actions.length) return null;

  async function send(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/payment/refund", { method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refundId: refund.id, ...body }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(friendlyMessage(data.error, response.status));
      setOpen(null); setReference(""); setNote("");
      onDone();
    } catch (cause) { setError(thrownMessage(cause)); }
    finally { setBusy(false); }
  }

  const target = open ? REFUND_ACTION_STATUS[open] : null;
  const problem = target ? manualRefundProblem({ method: refund.method, from: refund.status, to: target, note, reference }) : null;
  const needsReference = open === "confirm" && refund.method !== "cash";

  return <div className="mt-2 space-y-2">
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => <button key={action} type="button" disabled={busy}
        onClick={() => {
          if (action === "reconcile") void send({ reconcile: true });
          else if (action === "pending") void send({ status: "pending" });
          else { setOpen(open === action ? null : action); setError(""); }
        }}
        className={`h-10 rounded-xl px-3 text-sm font-medium disabled:opacity-50 ${action === "confirm" ? "bg-emerald-700 text-white"
          : action === "reconcile" ? "bg-stone-800 text-white" : "border border-stone-300 bg-white"}`}>{ACTION_LABEL[action]}</button>)}
    </div>
    {open && <form className="space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm"
      onSubmit={(event) => { event.preventDefault(); if (!problem) void send({ status: target, note: note.trim(), reference: reference.trim() || undefined }); }}>
      {needsReference && <label className="block">
        <span className="text-stone-600">轉帳序號／交易編號（證據）</span>
        <input value={reference} onChange={(e) => setReference(e.target.value)} aria-label="退款證據編號" required
          className="mt-1 h-11 w-full rounded-xl border border-stone-300 px-3" placeholder="例：網銀交易序號、LINE Pay 交易編號" />
      </label>}
      <label className="block">
        <span className="text-stone-600">{open === "confirm" ? (refund.method === "cash" ? "說明（誰、何時交給客人）" : "說明（核對了什麼）") : "原因"}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label={open === "confirm" ? "退款說明" : "退款原因"} required rows={2}
          className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2" />
      </label>
      {problem && (note || reference) && <p role="alert" className="text-xs text-red-700">{settlementFailure({ message: problem })?.error ?? problem}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || Boolean(problem)} className="h-10 rounded-xl bg-stone-900 px-4 font-semibold text-white disabled:opacity-40">
          送出（{ACTION_LABEL[open]}）</button>
        <button type="button" onClick={() => setOpen(null)} className="h-10 rounded-xl border border-stone-300 px-4">先不要</button>
      </div>
    </form>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
