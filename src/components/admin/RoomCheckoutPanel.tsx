"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Minus, Plus, Receipt, UtensilsCrossed, X } from "lucide-react";
import { friendlyMessage, thrownMessage } from "@/lib/friendly-error";
import { MenuPicker } from "@/components/MenuPicker";
import { selectionProblem } from "@/lib/option-sets";
import type { DraftItemInput } from "@/lib/reservation-preorder";
import type { MenuCategory, MenuItem, Order, OrderItem } from "@/types";
import { EXTEND_STEPS_MINUTES, addMinutes, newEndProblem, overtimeSettledEnd, type CheckoutBill } from "@/lib/room-checkout";
import { fmtClock, minutesText } from "@/components/admin/RoomFloor3D";

type View = {
  reservation: { customer_name: string; booking_code: string; start_time: string; status: string; guest_count?: number | null };
  preorder: { requires_reconfirmation: boolean } | null;
  order: Order | null;
  billing: { start_time: string; end_time: string; status: string; total_price: number | null; is_deposit_paid: boolean;
    next_start: string | null; bill: CheckoutBill | null };
};

const money = (n: number) => `NT$ ${Math.round(n).toLocaleString()}`;
const taipeiDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(iso));

/** 現場結帳面板：調整結束時間、快速點餐、包廂費＋餐費−訂金＝應收。 */
export function RoomCheckoutPanel({ reservationId, roomName, branchId, nowMs, onClose, onChanged }: {
  reservationId: string;
  roomName: string;
  branchId: string;
  nowMs: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [picking, setPicking] = useState<DraftItemInput[] | null>(null);
  const [customEnd, setCustomEnd] = useState("");
  const [confirmCheckout, setConfirmCheckout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const api = `/api/admin/reservation-orders/${encodeURIComponent(reservationId)}`;

  const load = useCallback(async () => {
    const response = await fetch(api, { credentials: "include" });
    const data = await response.json();
    if (!response.ok) throw new Error(friendlyMessage(data.error, response.status));
    setView(data as View);
    setCustomEnd(fmtClock((data as View).billing.end_time));
  }, [api]);

  useEffect(() => {
    setView(null); setError(""); setPicking(null); setConfirmCheckout(false);
    load().catch((cause) => setError(thrownMessage(cause, "載入失敗，請重新整理")));
  }, [load]);

  useEffect(() => {
    fetch(`/api/menu?branchId=${encodeURIComponent(branchId)}`)
      .then((response) => response.ok ? response.json() : { items: [], categories: [] })
      .then((data: { items?: MenuItem[]; categories?: MenuCategory[] }) => {
        setMenu((data.items ?? []).filter((item) => item.is_available));
        setCategories(data.categories ?? []);
      })
      .catch(() => setMenu([]));
  }, [branchId]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    try {
      const response = await fetch(api, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }) });
      const data = await response.json();
      if (!response.ok) throw new Error(friendlyMessage(data.error, response.status));
      await load();
      onChanged();
      return true;
    } catch (cause) { setError(thrownMessage(cause)); return false; }
    finally { setBusy(false); }
  }

  const shown = useMemo(() => menu.filter((item) => category === "all" || item.category_id === category), [menu, category]);
  const order = view?.order ?? null;
  const billing = view?.billing;
  const bill = billing?.bill ?? null;
  const paid = Boolean(order?.paid_at);
  const checkedIn = billing?.status === "checked_in";
  const canEditTime = checkedIn && !paid && !busy;
  const minutesLeft = billing ? Math.floor((new Date(billing.end_time).getTime() - nowMs) / 60_000) : null;
  const settleEnd = billing && checkedIn ? overtimeSettledEnd(billing.end_time, nowMs) : null;

  function endProblem(candidate: string) {
    return billing ? newEndProblem(billing.start_time, candidate, billing.next_start) : "載入中";
  }
  function setEnd(candidate: string) {
    const problem = endProblem(candidate);
    if (problem) { setError(problem); return; }
    void act("extend", { end_time: candidate });
  }
  function customEndIso() {
    if (!billing || !/^\d{2}:\d{2}$/.test(customEnd)) return null;
    return new Date(`${taipeiDate(billing.end_time)}T${customEnd}:00+08:00`).toISOString();
  }

  function tapItem(item: MenuItem) {
    if (item.options?.length) { setPicking([{ menu_item_id: item.id, quantity: 1, option_ids: [], special_notes: "" }]); return; }
    void act("add_items", { items: [{ menu_item_id: item.id, quantity: 1, option_ids: [], special_notes: "" }] });
  }

  return (
    <aside className="flex h-full flex-col bg-paper text-ink" aria-label={`${roomName} 結帳面板`}>
      <header className="flex items-start justify-between gap-3 border-b border-ink/10 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.3em] text-ink-faint">{roomName}</p>
          <h2 className="truncate font-serif text-xl">{view ? view.reservation.customer_name : "載入中…"}</h2>
          {view && <p className="mt-0.5 text-sm text-ink-soft">
            {view.reservation.guest_count ? `${view.reservation.guest_count} 人 · ` : ""}代碼 {view.reservation.booking_code}
          </p>}
        </div>
        <button type="button" onClick={onClose} aria-label="關閉" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-paper-deep">
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

        {billing && <section aria-labelledby="time-heading" className="rounded-2xl border border-ink/10 bg-white/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 id="time-heading" className="flex items-center gap-2 font-serif text-base"><Clock className="h-4 w-4 text-caramel-deep" strokeWidth={1.5} />使用時間</h3>
            {checkedIn && minutesLeft !== null && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${minutesLeft < 0 ? "bg-rose-100 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{minutesText(minutesLeft)}</span>}
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtClock(billing.start_time)} – {fmtClock(billing.end_time)}</p>
          <p className="mt-1 text-xs text-ink-faint">{billing.next_start ? `同包廂下一組 ${fmtClock(billing.next_start)} 開始（最多延到這裡）` : "今天後面沒有其他訂位"}</p>
          {checkedIn ? <>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <TimeButton label={`−${EXTEND_STEPS_MINUTES[0]}分`} disabled={!canEditTime || Boolean(endProblem(addMinutes(billing.end_time, -EXTEND_STEPS_MINUTES[0])))}
                onClick={() => setEnd(addMinutes(billing.end_time, -EXTEND_STEPS_MINUTES[0]))} />
              {EXTEND_STEPS_MINUTES.map((step) => <TimeButton key={step} primary label={`+${step >= 60 ? `${step / 60}小時` : `${step}分`}`}
                disabled={!canEditTime || Boolean(endProblem(addMinutes(billing.end_time, step)))} onClick={() => setEnd(addMinutes(billing.end_time, step))} />)}
              <TimeButton label="補超時" disabled={!canEditTime || !settleEnd || Boolean(settleEnd && endProblem(settleEnd))}
                onClick={() => settleEnd && setEnd(settleEnd)} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label className="text-sm text-ink-soft" htmlFor="custom-end">結束改為</label>
              <input id="custom-end" type="time" step={300} value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} disabled={!canEditTime}
                className="h-11 rounded-xl border border-ink/15 bg-white px-3 tabular-nums focus:border-caramel focus:outline-none" />
              <button type="button" disabled={!canEditTime || !customEndIso()} onClick={() => { const iso = customEndIso(); if (iso) setEnd(iso); }}
                className="h-11 rounded-xl border border-ink/15 px-4 text-sm font-medium hover:border-caramel disabled:opacity-40">套用</button>
            </div>
          </> : <p className="mt-3 text-sm text-ink-soft">{billing.status === "completed" ? "已結帳完成。" : "客人報到後才能點餐、延時與結帳。"}</p>}
        </section>}

        {view && !order && billing && ["pending", "confirmed"].includes(billing.status) && <section className="rounded-2xl border border-caramel/30 bg-caramel-glow/15 p-4">
          <p className="text-sm text-ink-soft">{view.preorder?.requires_reconfirmation ? "訂位內容變動過，請先到完整頁面確認預點餐。" : "客人到了嗎？確認到店後預點餐會送進備餐清單。"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy || Boolean(view.preorder?.requires_reconfirmation)} onClick={() => act("check_in")}
              className="h-11 rounded-xl bg-gradient-to-br from-[#b5742c] to-[#9d6519] px-5 font-semibold text-white shadow-[0_10px_30px_-12px_rgba(157,101,25,0.45)] disabled:opacity-50">確認到店</button>
            <Link href={`/admin/reservation-orders/${encodeURIComponent(reservationId)}`} className="flex h-11 items-center rounded-xl border border-ink/15 px-4 text-sm">完整點餐頁</Link>
          </div>
        </section>}

        {order && <section aria-labelledby="order-heading" className="rounded-2xl border border-ink/10 bg-white/70 p-4">
          <h3 id="order-heading" className="flex items-center gap-2 font-serif text-base"><UtensilsCrossed className="h-4 w-4 text-caramel-deep" strokeWidth={1.5} />這組點的餐</h3>
          {(order.order_items ?? []).length === 0 && <p className="mt-2 text-sm text-ink-faint">還沒點餐，從下方點選加入。</p>}
          <ul className="mt-2 divide-y divide-ink/5">
            {(order.order_items ?? []).map((item: OrderItem) => <li key={item.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.item_name}</p>
                <p className="truncate text-xs text-ink-faint">
                  {item.selected_options?.length ? `${item.selected_options.map((option) => option.name).join("、")} · ` : ""}
                  {item.served_at ? <span className="text-emerald-700">已出餐</span> : "待出餐"}
                </p>
              </div>
              {item.served_at || paid ? <span className="w-24 text-center text-sm tabular-nums">×{item.quantity}</span> : <div className="flex items-center">
                <button type="button" aria-label={`${item.item_name}減一`} disabled={busy}
                  onClick={() => item.quantity <= 1 ? act("remove_item", { item_id: item.id }) : act("update_quantity", { item_id: item.id, quantity: item.quantity - 1 })}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink/15 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                <span className="w-8 text-center tabular-nums">{item.quantity}</span>
                <button type="button" aria-label={`${item.item_name}加一`} disabled={busy || item.quantity >= 99}
                  onClick={() => act("update_quantity", { item_id: item.id, quantity: item.quantity + 1 })}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink/15 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
              </div>}
              <span className="w-20 text-right text-sm tabular-nums">{money(Number(item.unit_price) * item.quantity)}</span>
              {!item.served_at && <button type="button" disabled={busy} onClick={() => act("serve_item", { item_id: item.id })}
                className="h-9 rounded-lg bg-emerald-700/90 px-2 text-xs font-semibold text-white disabled:opacity-40">出餐</button>}
            </li>)}
          </ul>

          {!paid && <div className="mt-4 border-t border-ink/10 pt-4">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="tablist" aria-label="菜單分類">
              {[{ id: "all", name: "全部" }, ...categories].map((cat) => <button key={cat.id} type="button" role="tab" aria-selected={category === cat.id}
                onClick={() => setCategory(cat.id)}
                className={`h-9 shrink-0 rounded-full px-4 text-sm ${category === cat.id ? "bg-ink text-paper" : "border border-ink/15 bg-white"}`}>{cat.name}</button>)}
            </div>
            {picking ? <div className="rounded-xl bg-paper-deep/60 p-3">
              <MenuPicker items={menu.filter((item) => item.id === picking[0]?.menu_item_id)} value={picking} onChange={setPicking} disabled={busy} />
              {selectionProblem(menu, picking) && <p role="alert" className="mt-2 text-sm text-rose-700">{selectionProblem(menu, picking)}</p>}
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy || picking.length !== 1 || Boolean(selectionProblem(menu, picking))}
                  onClick={async () => { if (await act("add_items", { items: picking })) setPicking(null); }}
                  className="h-11 rounded-xl bg-ink px-4 text-sm font-semibold text-paper disabled:opacity-40">加入</button>
                <button type="button" onClick={() => setPicking(null)} className="h-11 rounded-xl border border-ink/15 px-4 text-sm">取消</button>
              </div>
            </div> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shown.map((item) => <button key={item.id} type="button" disabled={busy} onClick={() => tapItem(item)}
                className="flex min-h-[64px] flex-col justify-between rounded-xl border border-ink/10 bg-white px-3 py-2 text-left transition-[border-color,transform] duration-150 hover:border-caramel active:scale-[0.97] disabled:opacity-50">
                <span className="line-clamp-2 text-sm font-medium">{item.name}</span>
                <span className="text-xs text-caramel-deep">{money(Number(item.price))}{item.options?.length ? " · 選項" : ""}</span>
              </button>)}
              {shown.length === 0 && <p className="col-span-full text-sm text-ink-faint">此分類沒有可點的品項。</p>}
            </div>}
          </div>}
        </section>}
      </div>

      {bill && order && <footer className="sticky-bottom-safe border-t border-ink/10 bg-white/90 px-5 py-4 backdrop-blur">
        <dl className="space-y-1 text-sm">
          <Row label={`包廂費（${bill.isWeekend ? "假日" : "平日"} ${money(bill.hourlyRate)}/時 × ${bill.hours} 時）`} value={money(bill.roomFee)} />
          <Row label="餐費" value={money(bill.foodTotal)} />
          {bill.depositCredit > 0 && <Row label="已付訂金" value={`− ${money(bill.depositCredit)}`} />}
        </dl>
        <div className="mt-2 flex items-end justify-between border-t border-dashed border-ink/15 pt-2">
          <span className="flex items-center gap-1.5 font-serif"><Receipt className="h-4 w-4 text-caramel-deep" strokeWidth={1.5} />{paid ? "已收" : "現場應收"}</span>
          <strong className="text-3xl tabular-nums">{money(bill.due)}</strong>
        </div>
        {billing?.total_price != null && billing.total_price !== bill.roomFee && <p className="mt-1 text-[11px] text-ink-faint">訂位時金額 {money(billing.total_price)}（差額為延時或時段調整）</p>}
        {billing?.status !== "completed" && (confirmCheckout ? <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setConfirmCheckout(false)} className="h-12 rounded-xl border border-ink/15 font-medium">再等等</button>
          <button type="button" disabled={busy} onClick={async () => { if (await act("checkout")) setConfirmCheckout(false); }}
            className="h-12 rounded-xl bg-ink font-semibold text-paper disabled:opacity-50">確認已收 {money(bill.due)}</button>
        </div> : <button type="button" disabled={busy || !checkedIn} onClick={() => setConfirmCheckout(true)}
          className="mt-3 h-12 w-full rounded-[1.25rem] bg-gradient-to-br from-[#b5742c] to-[#9d6519] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(157,101,25,0.45)] transition-transform duration-150 active:scale-[0.985] disabled:opacity-50">
          結帳並完成（包廂空出）
        </button>)}
      </footer>}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-ink-soft">{label}</dt><dd className="tabular-nums">{value}</dd></div>;
}

function TimeButton({ label, onClick, disabled, primary = false }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled}
    className={`h-12 rounded-xl text-sm font-semibold transition-transform duration-150 active:scale-[0.97] disabled:opacity-35 ${primary ? "bg-caramel-deep text-white" : "border border-ink/15 bg-white"}`}>{label}</button>;
}
