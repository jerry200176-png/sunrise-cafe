"use client";

import { useCallback, useEffect, useState } from "react";
import { friendlyMessage, thrownMessage } from "@/lib/friendly-error";
import { REFUND_KIND_LABEL, REFUND_METHOD_LABEL, REFUND_REFERENCE_HINT, REFUND_STATUS_LABEL, refundReferenceValid } from "@/lib/refund-actions";
import { RefundActions } from "@/components/admin/RefundActions";
import { RefundAlerts, type RefundAlertRow } from "@/components/admin/RefundAlerts";

type Refund = { id: string; kind: string; amount: number; method: string; status: string; reason: string; created_at: string;
  requested_by_role: string; off_system?: boolean };
type RefundEvent = { seq: number; refund_id: string; status: string; provider_ref: string | null; evidence_ref: string | null;
  note: string | null; actor: string | null; actor_role: string | null; created_at: string; cash_handed_back?: boolean };
type Obligation = { settlement_id: string; owed: number; refunded: number; in_flight: number; unrequested: number };
type Data = {
  viewer?: { role: string; can_act: boolean };
  reservation: { id: string; booking_code: string | null; deposit_status: string | null; via_stripe: boolean };
  billing: { deposit_gross: number; deposit_refunded: number; deposit_refund_in_flight: boolean } | null;
  refunds: Refund[]; events: RefundEvent[]; alerts: RefundAlertRow[]; obligations?: Obligation[];
};

const MANUAL = [["cash", "現金"], ["transfer", "轉帳"], ["line_pay", "LINE Pay"], ["card", "刷卡退刷"], ["other", "其他"]] as const;
const ROLE_LABEL: Record<string, string> = { owner: "老闆", branch_manager: "店長", provider: "Stripe", staff: "店員" };
const when = (iso: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const newKey = (prefix: string) => `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const money = (n: number) => `NT$ ${Number(n).toLocaleString()}`;

function MethodChoice({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5 sm:col-span-2">
    {MANUAL.map(([method, text]) => <button key={method} type="button" role="radio" aria-checked={value === method} onClick={() => onChange(method)}
      className={`h-10 rounded-full border px-3 ${value === method ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white"}`}>{text}</button>)}
  </div>;
}

/**
 * 單一訂位的退款面板（Founder D7／A6）。退款只看帳本：每一步都是只能新增的事件，畫面只顯示、不改寫。
 * - 結帳的「退款處理中」只會因為這裡（或 Stripe 回報／對帳）把退款標成已退／失敗／取消而解除
 * - 結帳時欠客人的訂金差額：取消申請不會讓它消失，留在這裡直到補退成功（A6-9）
 * - 系統外退款補登：系統擋下的舊資料，人工核對、實際退款後由老闆／店長補記（A6-2）
 * - finance 只能看（A6-1）
 */
export function RefundPanel({ reservationId }: { reservationId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<string>("transfer");
  const [key, setKey] = useState(() => newKey("refund-ui"));
  const [busy, setBusy] = useState(false);
  const [owedMethod, setOwedMethod] = useState<string>("cash");
  const [owedKey, setOwedKey] = useState(() => newKey("refund-owed"));
  const [os, setOs] = useState({ amount: "", method: "transfer", reason: "", reference: "", handedBack: false });
  const [osKey, setOsKey] = useState(() => newKey("refund-offsystem"));

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

  async function post(body: Record<string, unknown>, after: () => void) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/payment/refund", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId, ...body }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(friendlyMessage(json.error, response.status));
      after();
      await load();
    } catch (cause) { setError(thrownMessage(cause, "退款操作失敗")); await load(); }
    finally { setBusy(false); }
  }

  const eventsOf = (id: string) => (data?.events ?? []).filter((event) => event.refund_id === id);
  const billing = data?.billing;
  const canAct = data?.viewer?.can_act ?? false;
  const osReady = Boolean(/^\d+$/.test(os.amount) && Number(os.amount) > 0 && os.reason.trim()
    && (os.method === "cash" ? os.handedBack : refundReferenceValid(os.method, os.reference)));

  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {data && !canAct && <p className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">唯讀：只有老闆或這間分店的店長可以處理退款。</p>}
    {data && <section className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
      <p className="font-semibold">訂位代號 {data.reservation.booking_code ?? "—"}</p>
      {billing && <p className="mt-1 text-stone-600">已付訂金 {money(billing.deposit_gross)}，真的已退 {money(billing.deposit_refunded)}</p>}
      {billing?.deposit_refund_in_flight && <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-2 text-amber-900">
        有一筆訂金退款還沒結束，這組暫時不能結帳。請確認已退（附證據）、標記失敗或取消。</p>}
    </section>}

    {data && (data.obligations ?? []).length > 0 && <section aria-labelledby="owed-heading" className="rounded-2xl border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900">
      <h2 id="owed-heading" className="font-semibold">還欠客人的訂金差額</h2>
      {(data.obligations ?? []).map((owed) => <div key={owed.settlement_id} className="mt-2">
        <p>結帳時應退 {money(owed.owed)}，已退 {money(owed.refunded)}，處理中 {money(owed.in_flight)}，
          <strong>還沒有人申請退的 {money(owed.unrequested)}</strong></p>
        {canAct && owed.unrequested > 0 && <form className="mt-2 space-y-2" onSubmit={(event) => {
          event.preventDefault();
          void post({ kind: "checkout_deposit_excess", amount: owed.unrequested, method: owedMethod, reason: "補退結帳時欠的訂金差額",
            idempotencyKey: owedKey }, () => setOwedKey(newKey("refund-owed")));
        }}>
          <MethodChoice value={owedMethod} onChange={setOwedMethod} label="補退方式" />
          <button type="submit" disabled={busy} className="h-10 rounded-xl bg-sky-900 px-4 font-semibold text-white disabled:opacity-40">
            申請補退 {money(owed.unrequested)}</button>
        </form>}
      </div>)}
    </section>}

    {data && <section aria-labelledby="refunds-heading" className="space-y-3">
      <h2 id="refunds-heading" className="font-semibold">退款紀錄</h2>
      {data.refunds.length === 0 && <p className="text-sm text-stone-500">這組還沒有退款。</p>}
      {data.refunds.map((refund) => <article key={refund.id} className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium">{REFUND_KIND_LABEL[refund.kind] ?? refund.kind} · {REFUND_METHOD_LABEL[refund.method] ?? refund.method}
            {refund.off_system ? " · 系統外補登" : ""}</p>
          <p className="tabular-nums font-semibold">{money(refund.amount)} <span className="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs">
            {REFUND_STATUS_LABEL[refund.status] ?? refund.status}</span></p>
        </div>
        <p className="mt-1 text-sm text-stone-500">原因：{refund.reason}</p>
        <ol aria-label="退款每一步" className="mt-2 space-y-1 border-l-2 border-stone-200 pl-3 text-xs text-stone-600">
          {eventsOf(refund.id).map((event) => <li key={event.seq}>
            {when(event.created_at)} · {REFUND_STATUS_LABEL[event.status] ?? event.status} · {ROLE_LABEL[event.actor_role ?? ""] ?? event.actor_role ?? ""}
            {event.evidence_ref ? ` · 證據 ${event.evidence_ref}` : ""}{event.provider_ref ? ` · Stripe ${event.provider_ref}` : ""}
            {event.cash_handed_back ? " · 已確認現金交還" : ""}{event.note ? ` · ${event.note}` : ""}
          </li>)}
        </ol>
        <RefundActions refund={refund} canAct={canAct} onDone={() => void load()} />
      </article>)}
    </section>}

    {data && data.alerts.length > 0 && <section aria-labelledby="alerts-heading" className="space-y-2">
      <h2 id="alerts-heading" className="font-semibold">警示</h2>
      <RefundAlerts alerts={data.alerts} canAct={canAct} onDone={() => void load()} />
    </section>}

    {data && canAct && <section aria-labelledby="request-heading" className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
      <h2 id="request-heading" className="font-semibold">申請退訂金</h2>
      <p className="mt-1 text-stone-500">{data.reservation.via_stripe ? "這筆訂金是 Stripe 付的：會經 Stripe 退款，結果由 Stripe 回報。"
        : "人工退款：先記成「已申請」，實際退了之後再按「確認已退」並附證據。"}</p>
      <form className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr]" onSubmit={(event) => {
        event.preventDefault();
        void post({ reason: reason.trim(), idempotencyKey: key, ...(amount ? { amount: Number(amount) } : {}),
          ...(data.reservation.via_stripe ? {} : { method }) }, () => { setAmount(""); setReason(""); setKey(newKey("refund-ui")); });
      }}>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="金額（空白=全部可退）"
          aria-label="退款金額" className="h-11 rounded-xl border border-stone-300 px-3 tabular-nums" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="原因（必填）" aria-label="退款申請原因" required
          className="h-11 rounded-xl border border-stone-300 px-3" />
        {!data.reservation.via_stripe && <MethodChoice value={method} onChange={setMethod} label="退款方式" />}
        <button type="submit" disabled={busy || !reason.trim()} className="h-11 rounded-xl bg-stone-900 px-4 font-semibold text-white disabled:opacity-40 sm:col-span-2">
          送出退款申請</button>
      </form>
    </section>}

    {data && canAct && <details className="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
      <summary className="cursor-pointer font-semibold">系統外退款補登（人工核對後）</summary>
      <p className="mt-1 text-stone-500">只用在系統擋下、但人工核對後確定要退、而且已經在系統外實際退款的情況（例如舊流程結帳的訂位）。
        要填原因與交易編號；現金要確認已交還。每一筆都會留一個需要有人複核的警示。</p>
      <form className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr]" onSubmit={(event) => {
        event.preventDefault();
        if (!osReady) return;
        void post({ offSystem: true, amount: Number(os.amount), method: os.method, reason: os.reason.trim(),
          ...(os.method === "cash" ? { cashHandedBack: os.handedBack } : { reference: os.reference.trim() }), idempotencyKey: osKey },
        () => { setOs({ amount: "", method: "transfer", reason: "", reference: "", handedBack: false }); setOsKey(newKey("refund-offsystem")); });
      }}>
        <input inputMode="numeric" value={os.amount} onChange={(e) => setOs({ ...os, amount: e.target.value.replace(/\D/g, "") })} placeholder="金額"
          aria-label="補登金額" className="h-11 rounded-xl border border-stone-300 px-3 tabular-nums" />
        <input value={os.reason} onChange={(e) => setOs({ ...os, reason: e.target.value })} placeholder="原因與核對結果（必填）"
          aria-label="補登原因" className="h-11 rounded-xl border border-stone-300 px-3" />
        <MethodChoice value={os.method} onChange={(value) => setOs({ ...os, method: value })} label="補登退款方式" />
        {os.method === "cash"
          ? <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={os.handedBack}
              onChange={(e) => setOs({ ...os, handedBack: e.target.checked })} aria-label="補登現金已交還" className="h-5 w-5" />
            我確認現金已實際交還客人</label>
          : <label className="block sm:col-span-2"><span className="text-stone-600">交易編號</span>
            <input value={os.reference} onChange={(e) => setOs({ ...os, reference: e.target.value })} aria-label="補登交易編號"
              placeholder={REFUND_REFERENCE_HINT[os.method]} className="mt-1 h-11 w-full rounded-xl border border-stone-300 px-3" />
            <span className="mt-1 block text-xs text-stone-500">{REFUND_REFERENCE_HINT[os.method]}</span></label>}
        <button type="submit" disabled={busy || !osReady} className="h-11 rounded-xl bg-stone-900 px-4 font-semibold text-white disabled:opacity-40 sm:col-span-2">
          補登已完成的退款</button>
      </form>
    </details>}
  </div>;
}
