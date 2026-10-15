"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { friendlyMessage, thrownMessage } from "@/lib/friendly-error";

export type RefundAlertRow = {
  id: string; reservation_id: string; kind: string; created_at: string; detail?: Record<string, unknown> | null;
  acknowledged_by?: string | null; acknowledged_by_role?: string | null; ack_note?: string | null; acknowledged_at?: string | null;
};

export const ALERT_LABEL: Record<string, string> = {
  provider_over_cap: "Stripe 後台退款超過可退金額",
  provider_after_checkout_credit: "結帳已折抵訂金後，Stripe 又退了款",
  provider_succeeded_after_cancel: "取消後 Stripe 又回報退款成功",
  provider_reservation_mismatch: "Stripe 退款對不上訂位",
  provider_outcome_unknown: "Stripe 退款結果不明：維持處理中，需要人工對帳",
  offsystem_refund_recorded: "系統外退款補登：需要複核",
};
const ROLE_LABEL: Record<string, string> = { owner: "老闆", branch_manager: "店長" };
const when = (iso: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/**
 * 退款警示（Founder A6-4：每一個警示都要有人負責）。還沒有人認領的警示可以由老闆／本分店店長寫說明認領；
 * 認領只代表「有人負責處理」，不會改變退款狀態（結果不明的 Stripe 退款仍維持處理中）。
 */
export function RefundAlerts({ alerts, canAct, onDone, linkToReservation = false }: {
  alerts: RefundAlertRow[]; canAct: boolean; onDone: () => void; linkToReservation?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function acknowledge(alertId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/payment/refund", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId, acknowledge: true, note: note.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(friendlyMessage(data.error, response.status));
      setOpen(null); setNote("");
      onDone();
    } catch (cause) { setError(thrownMessage(cause)); }
    finally { setBusy(false); }
  }

  if (!alerts.length) return null;
  return <ul aria-label="退款警示" className="space-y-2">
    {alerts.map((alert) => <li key={alert.id} className={`rounded-xl border p-3 text-sm ${alert.acknowledged_at
      ? "border-stone-200 bg-white text-stone-700" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
      <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
        {ALERT_LABEL[alert.kind] ?? alert.kind} · {when(alert.created_at)}</p>
      {alert.acknowledged_at
        ? <p className="mt-1">負責人：{ROLE_LABEL[alert.acknowledged_by_role ?? ""] ?? alert.acknowledged_by_role} {alert.acknowledged_by}
          （{when(alert.acknowledged_at)}）· {alert.ack_note}</p>
        : <p className="mt-1">還沒有人負責</p>}
      {linkToReservation && <Link href={`/admin/refunds/${encodeURIComponent(alert.reservation_id)}`} className="mt-1 inline-block underline">看這組</Link>}
      {!alert.acknowledged_at && canAct && (open === alert.id
        ? <form className="mt-2 space-y-2" onSubmit={(event) => { event.preventDefault(); if (note.trim()) void acknowledge(alert.id); }}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="認領說明" rows={2} required
            placeholder="打算怎麼處理（必填）" className="w-full rounded-xl border border-stone-300 px-3 py-2 text-stone-900" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !note.trim()} className="h-10 rounded-xl bg-stone-900 px-4 font-semibold text-white disabled:opacity-40">
              由我負責</button>
            <button type="button" onClick={() => setOpen(null)} className="h-10 rounded-xl border border-stone-300 bg-white px-4">先不要</button>
          </div>
        </form>
        : <button type="button" onClick={() => { setOpen(alert.id); setNote(""); setError(""); }}
          className="mt-2 h-10 rounded-xl border border-amber-400 bg-white px-3 font-medium">認領這個警示</button>)}
      {open === alert.id && error && <p role="alert" className="mt-1 text-red-700">{error}</p>}
    </li>)}
  </ul>;
}
