"use client";

import { useCallback, useEffect, useState } from "react";
import { friendlyMessage, thrownMessage } from "@/lib/friendly-error";
import { REFUND_KIND_LABEL, REFUND_METHOD_LABEL, REFUND_STATUS_LABEL } from "@/lib/refund-actions";
import { RefundActions } from "@/components/admin/RefundActions";

type Refund = { id: string; kind: string; amount: number; method: string; status: string; reason: string; created_at: string;
  requested_by_role: string };
type RefundEvent = { seq: number; refund_id: string; status: string; provider_ref: string | null; evidence_ref: string | null;
  note: string | null; actor: string | null; actor_role: string | null; created_at: string };
type Data = {
  reservation: { id: string; booking_code: string | null; deposit_status: string | null; via_stripe: boolean };
  billing: { deposit_gross: number; deposit_refunded: number; deposit_refund_in_flight: boolean } | null;
  refunds: Refund[]; events: RefundEvent[]; alerts: Array<{ id: string; kind: string; created_at: string }>;
};

const MANUAL = [["cash", "現金"], ["transfer", "轉帳"], ["line_pay", "LINE Pay"], ["card", "刷卡退刷"], ["other", "其他"]] as const;
const ROLE_LABEL: Record<string, string> = { owner: "老闆", branch_manager: "店長", provider: "Stripe", staff: "店員" };
const when = (iso: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const newKey = () => `refund-ui:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

/**
 * 單一訂位的退款面板（Founder D7）。退款只看帳本：每一步都是只能新增的事件，畫面只顯示、不改寫。
 * 結帳的「退款處理中」只會因為這裡（或 Stripe 回報／對帳）把退款標成已退／失敗／取消而解除。
 */
export function RefundPanel({ reservationId }: { reservationId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<string>("transfer");
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/payment/refund?reservationId=${encodeURIComponent(reservationId)}`, { credentials: "include" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(friendlyMessage(json.error, response.status));
      setData(json as Data);
    } catch (cause) { setError(thrownMessage(cause, "讀取退款紀錄失敗，請重新整理")); }
  }, [reservationId]);
  useEffect(() => { void load(); }, [load]);

  async function request() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/payment/refund", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId, reason: reason.trim(), idempotencyKey: key,
          ...(amount ? { amount: Number(amount) } : {}), ...(data?.reservation.via_stripe ? {} : { method }) }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(friendlyMessage(json.error, response.status));
      setAmount(""); setReason(""); setKey(newKey());
      await load();
    } catch (cause) { setError(thrownMessage(cause, "退款申請失敗")); await load(); }
    finally { setBusy(false); }
  }

  const eventsOf = (id: string) => (data?.events ?? []).filter((event) => event.refund_id === id);
  const billing = data?.billing;

  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {data && <section className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
      <p className="font-semibold">訂位代號 {data.reservation.booking_code ?? "—"}</p>
      {billing && <p className="mt-1 text-stone-600">已付訂金 NT$ {Number(billing.deposit_gross).toLocaleString()}，真的已退 NT$ {Number(billing.deposit_refunded).toLocaleString()}</p>}
      {billing?.deposit_refund_in_flight && <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-2 text-amber-900">
        有一筆訂金退款還沒結束，這組暫時不能結帳。請確認已退（附證據）、標記失敗或取消。</p>}
    </section>}

    {data && <section aria-labelledby="refunds-heading" className="space-y-3">
      <h2 id="refunds-heading" className="font-semibold">退款紀錄</h2>
      {data.refunds.length === 0 && <p className="text-sm text-stone-500">這組還沒有退款。</p>}
      {data.refunds.map((refund) => <article key={refund.id} className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium">{REFUND_KIND_LABEL[refund.kind] ?? refund.kind} · {REFUND_METHOD_LABEL[refund.method] ?? refund.method}</p>
          <p className="tabular-nums font-semibold">NT$ {refund.amount.toLocaleString()} <span className="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs">
            {REFUND_STATUS_LABEL[refund.status] ?? refund.status}</span></p>
        </div>
        <p className="mt-1 text-sm text-stone-500">原因：{refund.reason}</p>
        <ol aria-label="退款每一步" className="mt-2 space-y-1 border-l-2 border-stone-200 pl-3 text-xs text-stone-600">
          {eventsOf(refund.id).map((event) => <li key={event.seq}>
            {when(event.created_at)} · {REFUND_STATUS_LABEL[event.status] ?? event.status} · {ROLE_LABEL[event.actor_role ?? ""] ?? event.actor_role ?? ""}
            {event.evidence_ref ? ` · 證據 ${event.evidence_ref}` : ""}{event.provider_ref ? ` · Stripe ${event.provider_ref}` : ""}
            {event.note ? ` · ${event.note}` : ""}
          </li>)}
        </ol>
        <RefundActions refund={refund} onDone={() => void load()} />
      </article>)}
    </section>}

    {data && <section aria-labelledby="request-heading" className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
      <h2 id="request-heading" className="font-semibold">申請退訂金</h2>
      <p className="mt-1 text-stone-500">{data.reservation.via_stripe ? "這筆訂金是 Stripe 付的：會經 Stripe 退款，結果由 Stripe 回報。"
        : "人工退款：先記成「已申請」，實際退了之後再按「確認已退」並附證據。"}</p>
      <form className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr]" onSubmit={(event) => { event.preventDefault(); void request(); }}>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="金額（空白=全部可退）"
          aria-label="退款金額" className="h-11 rounded-xl border border-stone-300 px-3 tabular-nums" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="原因（必填）" aria-label="退款申請原因" required
          className="h-11 rounded-xl border border-stone-300 px-3" />
        {!data.reservation.via_stripe && <div role="radiogroup" aria-label="退款方式" className="flex flex-wrap gap-1.5 sm:col-span-2">
          {MANUAL.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={method === value} onClick={() => setMethod(value)}
            className={`h-10 rounded-full border px-3 ${method === value ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white"}`}>{label}</button>)}
        </div>}
        <button type="submit" disabled={busy || !reason.trim()} className="h-11 rounded-xl bg-stone-900 px-4 font-semibold text-white disabled:opacity-40 sm:col-span-2">
          送出退款申請</button>
      </form>
    </section>}
  </div>;
}
