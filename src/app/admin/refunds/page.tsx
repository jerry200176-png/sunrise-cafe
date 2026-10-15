"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { RefundActions } from "@/components/admin/RefundActions";
import { RefundAlerts, type RefundAlertRow } from "@/components/admin/RefundAlerts";
import { friendlyMessage, thrownMessage } from "@/lib/friendly-error";
import { REFUND_KIND_LABEL, REFUND_METHOD_LABEL, REFUND_STATUS_LABEL } from "@/lib/refund-actions";

type OpenRefund = {
  id: string; reservation_id: string; kind: string; amount: number; method: string; status: string; reason: string;
  created_at: string; status_at: string;
  reservation: { booking_code: string | null; customer_name: string; start_time: string; status: string } | null;
};
type Obligation = { settlement_id: string; reservation_id: string; owed: number; refunded: number; in_flight: number; unrequested: number;
  reservation: OpenRefund["reservation"] };
const when = (iso: string) => new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/**
 * 退款處理（老闆／店長；finance 唯讀）：還沒結束的退款、還欠客人的訂金差額、還沒有人認領的警示。
 * 每筆退款都要走「確認已退（附證據）／失敗／取消」才會結束；欠款要等補退成功才會從清單消失。
 */
export default function AdminRefundsPage() {
  const [refunds, setRefunds] = useState<OpenRefund[] | null>(null);
  const [alerts, setAlerts] = useState<RefundAlertRow[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [canAct, setCanAct] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/payment/refund?view=open", { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(friendlyMessage(data.error, response.status));
      setRefunds(data.refunds ?? []); setAlerts(data.alerts ?? []); setObligations(data.obligations ?? []);
      setCanAct(Boolean(data.viewer?.can_act));
    } catch (cause) { setError(thrownMessage(cause, "讀取退款失敗，請重新整理")); setRefunds([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <AdminShell title="退款處理" subtitle={refunds ? `還沒結束 ${refunds.length} 筆，欠款 ${obligations.length} 筆，待認領警示 ${alerts.length} 個` : "載入中…"} backHref="/admin/payments"
    actions={<button type="button" onClick={() => void load()} aria-label="重新整理"
      className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100"><RefreshCw className="h-4 w-4" strokeWidth={1.5} /></button>}>
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <p className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
        退款在「已申請／處理中」時，這組訂位不能結帳。要結束一筆退款，只能確認已退（非現金要附格式正確的交易編號和說明；現金要確認已交還）、標記失敗或取消（都要寫原因）。Stripe 退款只能按「向 Stripe 對帳」，結果由 Stripe 決定；查不到結果時維持處理中並開警示。
        {!canAct && <span className="mt-1 block font-medium">你目前是唯讀：只有老闆或這間分店的店長可以處理。</span>}
      </p>
      {alerts.length > 0 && <section aria-labelledby="alerts-heading" className="space-y-2">
        <h2 id="alerts-heading" className="font-semibold">還沒有人負責的警示</h2>
        <RefundAlerts alerts={alerts} canAct={canAct} onDone={() => void load()} linkToReservation />
      </section>}
      {obligations.length > 0 && <section aria-labelledby="owed-heading" className="space-y-2">
        <h2 id="owed-heading" className="font-semibold">還欠客人的訂金差額</h2>
        {obligations.map((owed) => <Link key={owed.settlement_id} href={`/admin/refunds/${encodeURIComponent(owed.reservation_id)}`}
          className="block rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
          {owed.reservation?.customer_name ?? "（找不到訂位）"} {owed.reservation?.booking_code ?? ""} · 應退 NT$ {owed.owed.toLocaleString()}，
          已退 NT$ {owed.refunded.toLocaleString()}，處理中 NT$ {owed.in_flight.toLocaleString()}，還沒申請 NT$ {owed.unrequested.toLocaleString()}</Link>)}
      </section>}
      <section aria-labelledby="open-heading" className="space-y-3">
        <h2 id="open-heading" className="font-semibold">還沒結束的退款</h2>
        {refunds && refunds.length === 0 && !error && <p className="text-sm text-stone-500">目前沒有處理中的退款。</p>}
        {refunds?.map((refund) => <article key={refund.id} className="rounded-2xl border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">{refund.reservation?.customer_name ?? "（找不到訂位）"}
              <span className="ml-2 text-sm font-normal text-stone-500">{refund.reservation?.booking_code ?? ""}</span></p>
            <p className="tabular-nums text-lg font-semibold">NT$ {refund.amount.toLocaleString()}</p>
          </div>
          <p className="mt-1 text-sm text-stone-600">{REFUND_KIND_LABEL[refund.kind] ?? refund.kind} · {REFUND_METHOD_LABEL[refund.method] ?? refund.method} ·
            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{REFUND_STATUS_LABEL[refund.status] ?? refund.status}</span>
            <span className="ml-2 text-stone-500">{when(refund.status_at ?? refund.created_at)}</span></p>
          <p className="mt-1 text-sm text-stone-500">原因：{refund.reason}</p>
          <RefundActions refund={refund} canAct={canAct} onDone={() => void load()} />
          <Link href={`/admin/refunds/${encodeURIComponent(refund.reservation_id)}`} className="mt-2 inline-block text-sm text-amber-800 underline">看這組的退款紀錄</Link>
        </article>)}
      </section>
    </div>
  </AdminShell>;
}
