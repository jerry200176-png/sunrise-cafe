"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Clock, Minus, Plus, Receipt, UtensilsCrossed, X } from "lucide-react";
import { friendlyMessage, responseError, thrownMessage } from "@/lib/friendly-error";
import { MenuPicker } from "@/components/MenuPicker";
import { selectionProblem } from "@/lib/option-sets";
import type { DraftItemInput } from "@/lib/reservation-preorder";
import type { MenuCategory, MenuItem, Order, OrderItem } from "@/types";
import { EXTEND_STEPS_MINUTES, addMinutes, foodStillOwed, newEndProblem, overtimeSettledEnd, resolveClockNear, type CheckoutBill } from "@/lib/room-checkout";
import { fmtClock, minutesText } from "@/components/admin/RoomFloor3D";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/room-settlement";

type View = {
  reservation: { customer_name: string; booking_code: string; start_time: string; status: string; guest_count?: number | null };
  preorder: { requires_reconfirmation: boolean } | null;
  order: Order | null;
  /** 結帳紀錄（#444）已上線：結帳要選付款方式，可打折 */
  settlementsReady?: boolean;
  billing: { start_time: string; end_time: string; status: string; total_price: number | null; is_deposit_paid: boolean;
    next_start: string | null; bill: CheckoutBill | null };
};

const money = (n: number) => `NT$ ${Math.round(n).toLocaleString()}`;
const durationText = (hours: number) => {
  const minutes = Math.round(hours * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h} 小時 ${m} 分` : h ? `${h} 小時` : `${m} 分`;
};

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
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** 第一次載入就失敗：沒有畫面可顯示，要給「重試」而不是一直顯示載入中 */
  const [loadFailed, setLoadFailed] = useState("");
  const [menuState, setMenuState] = useState<"loading" | "ready" | "error">("loading");
  const api = `/api/admin/reservation-orders/${encodeURIComponent(reservationId)}`;

  // 目前顯示的是哪一組：切換組別後，舊組晚回來的回應一律丟掉，避免畫面是 A 組、按鈕卻送到 B 組
  const currentApi = useRef(api);
  currentApi.current = api;
  // 每次請求一個遞增編號：A→B→A 切回來時，A 的舊請求端點相同，只比端點擋不住
  const requestGen = useRef(0);

  const load = useCallback(async () => {
    const requested = api;
    const gen = ++requestGen.current;
    const response = await fetch(requested, { credentials: "include" });
    // 逾時等情況回的是網頁不是 JSON：一樣要變成看得懂的錯誤
    const data = response.ok ? await response.json() : null;
    if (currentApi.current !== requested || gen !== requestGen.current) return;
    if (!response.ok) throw new Error(await responseError(response));
    setView(data as View);
    setLoadFailed("");
    setCustomEnd(fmtClock((data as View).billing.end_time));
  }, [api]);

  const firstLoad = useCallback(() => {
    setLoadFailed("");
    load().catch((cause) => setLoadFailed(thrownMessage(cause, "這組的資料載入失敗")));
  }, [load]);

  useEffect(() => {
    setView(null); setError(""); setPicking(null); setConfirmCheckout(false);
    setMethod("cash"); setDiscount(""); setDiscountReason("");
    firstLoad();
  }, [firstLoad]);

  const menuSeq = useRef(0);
  const loadMenu = useCallback(() => {
    const seq = ++menuSeq.current;
    setMenuState("loading");
    fetch(`/api/menu?branchId=${encodeURIComponent(branchId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return response.json() as Promise<{ items?: MenuItem[]; categories?: MenuCategory[] }>;
      })
      .then((data) => {
        if (seq !== menuSeq.current) return;
        setMenu((data.items ?? []).filter((item) => item.is_available));
        setCategories(data.categories ?? []);
        setMenuState("ready");
      })
      // 菜單讀不到時不能假裝「這一類沒有東西」：顯示錯誤並可重試
      .catch(() => { if (seq === menuSeq.current) setMenuState("error"); });
  }, [branchId]);

  useEffect(() => { loadMenu(); }, [loadMenu]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    const requested = api;
    const gen = ++requestGen.current;
    try {
      const response = await fetch(requested, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }) });
      const data = await response.json();
      if (!response.ok) throw new Error(friendlyMessage(data.error, response.status));
      // 回應已帶最新資料：直接套用。動作已成功，就不要因為之後的重新整理失敗而回報失敗（避免重按而重複加點）。
      if (currentApi.current !== requested || gen !== requestGen.current) { onChanged(); return true; }
      // POST 回應帶 order／billing／preorder（沒有 reservation）：合併進目前畫面
      if (data?.billing) {
        setView((previous) => previous ? { ...previous, ...(data as Partial<View>) } : previous);
        setCustomEnd(fmtClock((data as View).billing.end_time));
      } else await load().catch(() => undefined);
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
  // 延長只看客人是否還在包廂（餐費先結過也能延長，伺服器同樣只檢查 checked_in）
  const canEditTime = checkedIn && !busy;
  const roomSettled = billing?.status === "completed";
  // 報到後被取消的組：不收包廂費，只剩餐費要補記
  const stayCancelled = billing?.status === "cancelled" || billing?.status === "no_show";
  const ready = Boolean(view?.settlementsReady);
  const discountAmount = ready && /^\d+$/.test(discount) ? Number(discount) : 0;
  const collect = bill ? Math.max(0, bill.due - discountAmount) : 0;
  const payment = ready ? { payment_method: method } : {};
  const discountProblem = discountAmount > 0 && !discountReason.trim() ? "打折要填原因"
    : bill && discountAmount > bill.due ? "折扣不能比要收的多" : "";
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
    return billing ? resolveClockNear(customEnd, billing.end_time) : null;
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
          <h2 className="truncate font-serif text-xl">{view ? view.reservation.customer_name : loadFailed ? "載入失敗" : "載入中…"}</h2>
          {view && <p className="mt-0.5 text-sm text-ink-soft">
            {view.reservation.guest_count ? `${view.reservation.guest_count} 位 · ` : ""}訂位代號 {view.reservation.booking_code}
          </p>}
        </div>
        <button type="button" onClick={onClose} aria-label="關閉" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-paper-deep">
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        {!view && loadFailed && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p>{loadFailed}</p>
          <button type="button" onClick={firstLoad} className="mt-3 h-11 rounded-xl bg-ink px-4 font-semibold text-paper">重試</button>
        </div>}
        {!view && !loadFailed && <p className="py-10 text-center text-sm text-ink-faint">載入中…</p>}

        {billing && <section aria-labelledby="time-heading" className="rounded-2xl border border-ink/10 bg-white/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 id="time-heading" className="flex items-center gap-2 font-serif text-base"><Clock className="h-4 w-4 text-caramel-deep" strokeWidth={1.5} />時間</h3>
            {checkedIn && minutesLeft !== null && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${minutesLeft < 0 ? "bg-rose-100 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{minutesText(minutesLeft)}</span>}
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtClock(billing.start_time)} – {fmtClock(billing.end_time)}</p>
          <p className="mt-1 text-xs text-ink-faint">{billing.next_start ? `下一組客人 ${fmtClock(billing.next_start)} 進場，最多延到這時候` : "這間今天後面沒有客人，可以放心延長"}</p>
          {checkedIn ? <>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <TimeButton label={`−${EXTEND_STEPS_MINUTES[0]}分`} disabled={!canEditTime || Boolean(endProblem(addMinutes(billing.end_time, -EXTEND_STEPS_MINUTES[0])))}
                onClick={() => setEnd(addMinutes(billing.end_time, -EXTEND_STEPS_MINUTES[0]))} />
              {EXTEND_STEPS_MINUTES.map((step) => <TimeButton key={step} primary label={`+${step >= 60 ? `${step / 60}小時` : `${step}分`}`}
                disabled={!canEditTime || Boolean(endProblem(addMinutes(billing.end_time, step)))} onClick={() => setEnd(addMinutes(billing.end_time, step))} />)}
              <TimeButton label="超時補收" disabled={!canEditTime || !settleEnd || Boolean(settleEnd && endProblem(settleEnd))}
                onClick={() => settleEnd && setEnd(settleEnd)} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label className="text-sm text-ink-soft" htmlFor="custom-end">結束時間改成</label>
              <input id="custom-end" type="time" step={300} value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} disabled={!canEditTime}
                className="h-11 rounded-xl border border-ink/15 bg-white px-3 tabular-nums focus:border-caramel focus:outline-none" />
              <button type="button" disabled={!canEditTime || !customEndIso()} onClick={() => { const iso = customEndIso(); if (iso) setEnd(iso); }}
                className="h-11 rounded-xl border border-ink/15 px-4 text-sm font-medium hover:border-caramel disabled:opacity-40">確定</button>
            </div>
          </> : <p className="mt-3 text-sm text-ink-soft">{billing.status === "completed" ? "這組已經結帳了。" : "客人到了以後，才能點餐、延長時間和結帳。"}</p>}
        </section>}

        {view && billing && (order ? ["pending", "confirmed"] : ["pending", "confirmed", "checked_in"]).includes(billing.status) && <section className="rounded-2xl border border-caramel/30 bg-caramel-glow/15 p-4">
          <p className="text-sm text-ink-soft">{view.preorder?.requires_reconfirmation ? "這組的預約改過，請先打開「看預點的餐」確認一下餐點。"
            : checkedIn ? "這組已經報到，但還沒開點餐單。按下去就可以開始點餐、結帳。" : "客人到了嗎？按下去之後，他們先點好的餐會通知廚房準備。"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy || Boolean(view.preorder?.requires_reconfirmation)} onClick={() => act("check_in")}
              className="h-11 rounded-xl bg-gradient-to-br from-[#b5742c] to-[#9d6519] px-5 font-semibold text-white shadow-[0_10px_30px_-12px_rgba(157,101,25,0.45)] disabled:opacity-50">{checkedIn ? "開始點餐" : "客人到了"}</button>
            <Link href={`/admin/reservation-orders/${encodeURIComponent(reservationId)}`} className="flex h-11 items-center rounded-xl border border-ink/15 px-4 text-sm">看預點的餐</Link>
          </div>
        </section>}

        {order && <section aria-labelledby="order-heading" className="rounded-2xl border border-ink/10 bg-white/70 p-4">
          <h3 id="order-heading" className="flex items-center gap-2 font-serif text-base"><UtensilsCrossed className="h-4 w-4 text-caramel-deep" strokeWidth={1.5} />這組點的餐</h3>
          {(order.order_items ?? []).length === 0 && <p className="mt-2 text-sm text-ink-faint">還沒點餐，點下面的品項就會加進來。</p>}
          <ul className="mt-2 divide-y divide-ink/5">
            {(order.order_items ?? []).map((item: OrderItem) => <li key={item.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.item_name}</p>
                <p className="truncate text-xs text-ink-faint">
                  {item.selected_options?.length ? `${item.selected_options.map((option) => option.name).join("、")} · ` : ""}
                  {item.served_at ? <span className="text-emerald-700">已送</span> : "還沒送"}
                </p>
              </div>
              {item.served_at || paid || !checkedIn ? <span className="w-24 text-center text-sm tabular-nums">×{item.quantity}</span> : <div className="flex items-center">
                <button type="button" aria-label={`${item.item_name}減一`} disabled={busy}
                  onClick={() => item.quantity <= 1 ? act("remove_item", { item_id: item.id }) : act("update_quantity", { item_id: item.id, quantity: item.quantity - 1 })}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink/15 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                <span className="w-8 text-center tabular-nums">{item.quantity}</span>
                <button type="button" aria-label={`${item.item_name}加一`} disabled={busy || item.quantity >= 99}
                  onClick={() => act("update_quantity", { item_id: item.id, quantity: item.quantity + 1 })}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink/15 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
              </div>}
              <span className="w-20 text-right text-sm tabular-nums">{money(Number(item.unit_price) * item.quantity)}</span>
              {!item.served_at && (checkedIn || roomSettled || stayCancelled) && <button type="button" disabled={busy} onClick={() => act("serve_item", { item_id: item.id })}
                className="h-9 rounded-lg bg-emerald-700/90 px-2 text-xs font-semibold text-white disabled:opacity-40">送了</button>}
            </li>)}
          </ul>

          {!paid && checkedIn && <div className="mt-4 border-t border-ink/10 pt-4">
            {menuState === "ready" && menu.length > 0 && <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="tablist" aria-label="菜單種類">
              {[{ id: "all", name: "全部" }, ...categories].map((cat) => <button key={cat.id} type="button" role="tab" aria-selected={category === cat.id}
                onClick={() => setCategory(cat.id)}
                className={`h-9 shrink-0 rounded-full px-4 text-sm ${category === cat.id ? "bg-ink text-paper" : "border border-ink/15 bg-white"}`}>{cat.name}</button>)}
            </div>}
            {menuState === "error" ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              菜單載入失敗，暫時不能加點。
              <button type="button" onClick={loadMenu} className="ml-2 h-9 rounded-lg border border-rose-300 bg-white px-3 font-medium">重試</button>
            </div> : menuState === "loading" ? <p className="text-sm text-ink-faint">菜單載入中…</p>
            : menu.length === 0 ? <p className="text-sm text-ink-faint">這間分店還沒有可以點的品項，請先到「菜單」新增。</p>
            : picking ? <div className="rounded-xl bg-paper-deep/60 p-3">
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
                <span className="text-xs text-caramel-deep">{money(Number(item.price))}{item.options?.length ? " · 可選口味" : ""}</span>
              </button>)}
              {shown.length === 0 && <p className="col-span-full text-sm text-ink-faint">這一類目前沒有可以點的。</p>}
            </div>}
          </div>}
        </section>}
      </div>

      {bill && order && <footer className="sticky-bottom-safe border-t border-ink/10 bg-white/90 px-5 py-4 backdrop-blur">
        <dl className="space-y-1 text-sm">
          <Row label={bill.bookedRoomFee != null && bill.extensionFee
            ? `包廂費（預約 ${money(bill.bookedRoomFee)}，${bill.extensionFee > 0 ? "延長" : "提早離開"} ${bill.extensionFee > 0 ? "+" : "−"} ${money(Math.abs(bill.extensionFee))}，用了 ${durationText(bill.hours)}）`
            : `包廂費（${bill.isWeekend ? "假日" : "平日"}每小時 ${money(bill.hourlyRate)}，用了 ${durationText(bill.hours)}）`} value={money(bill.roomFee)} />
          <Row label={bill.foodSettled ? "餐費（之前已經收過）" : "餐費"} value={bill.foodSettled ? `${money(bill.foodTotal)} ✓` : money(bill.foodTotal)} />
          {bill.depositCredit > 0 && <Row label="已付訂金" value={`− ${money(bill.depositCredit)}`} />}
        </dl>
        <div className="mt-2 flex items-end justify-between border-t border-dashed border-ink/15 pt-2">
          <span className="flex items-center gap-1.5 font-serif"><Receipt className="h-4 w-4 text-caramel-deep" strokeWidth={1.5} />{roomSettled && paid ? "已經收了" : roomSettled ? "包廂已結帳" : stayCancelled ? "已取消，只收餐費" : "這組要收"}</span>
          <strong className="text-3xl tabular-nums">{money((stayCancelled || roomSettled) && !paid ? bill.foodTotal : stayCancelled ? 0 : bill.due)}</strong>
        </div>
        {bill.refund > 0 && !stayCancelled && !roomSettled && <p className="mt-2 rounded-xl border border-sky-300 bg-sky-50 p-2 text-sm text-sky-900">
          時間縮短了，訂金比要收的多：結帳時要退客人 <strong className="tabular-nums">{money(bill.refund)}</strong>。</p>}
        {billing?.total_price != null && billing.total_price !== bill.roomFee && <p className="mt-1 text-[11px] text-ink-faint">預約時是 {money(billing.total_price)}，多出來的是延長的時間</p>}
        {/* 餐費 0 元沒有東西可補記（#447 P2-2） */}
        {foodStillOwed(billing?.status, order.paid_at, bill.foodTotal) && <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {stayCancelled ? "這組已經取消" : "這組已經結束"}，但餐費 {money(bill.foodTotal)} 還沒記收款。
          {ready && <MethodPicker value={method} onChange={setMethod} />}
          <button type="button" disabled={busy} onClick={() => act("settle", payment)}
            className="mt-2 block h-11 w-full rounded-xl bg-ink font-semibold text-paper disabled:opacity-50">收到餐費 {money(bill.foodTotal)}，補記</button>
        </div>}
        {!roomSettled && !stayCancelled && (confirmCheckout ? <div className="mt-3 space-y-2">
          {ready && (collect > 0 || bill.refund > 0) && <MethodPicker value={method} onChange={setMethod} label={bill.refund > 0 ? "怎麼退" : "怎麼收"} />}
          {ready && bill.due > 0 && <details className="rounded-xl border border-ink/10 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-ink-soft">打折（只有老闆或店長可以）</summary>
            <div className="mt-2 grid grid-cols-[7rem_1fr] gap-2">
              <input inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ""))} placeholder="折多少"
                aria-label="折扣金額" className="h-11 rounded-xl border border-ink/15 px-3 tabular-nums" />
              <input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="原因（必填）"
                aria-label="折扣原因" className="h-11 rounded-xl border border-ink/15 px-3" />
            </div>
            {discountProblem && <p className="mt-1 text-xs text-red-700">{discountProblem}</p>}
          </details>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirmCheckout(false)} className="h-12 rounded-xl border border-ink/15 font-medium">再等等</button>
            <button type="button" disabled={busy || Boolean(discountProblem)} onClick={async () => {
              const ok = await act("checkout", { expected_due: bill.due, expected_refund: bill.refund, ...payment,
                ...(discountAmount > 0 ? { discount_amount: discountAmount, discount_reason: discountReason.trim() } : {}) });
              if (ok) setConfirmCheckout(false); else void load().catch(() => undefined);
            }}
              className="h-12 rounded-xl bg-ink font-semibold text-paper disabled:opacity-50">{bill.refund > 0 ? `已退客人 ${money(bill.refund)}，結帳` : `確定收到 ${money(collect)}`}</button>
          </div>
        </div> : <button type="button" disabled={busy || !checkedIn} onClick={() => setConfirmCheckout(true)}
          className="mt-3 h-12 w-full rounded-[1.25rem] bg-gradient-to-br from-[#b5742c] to-[#9d6519] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(157,101,25,0.45)] transition-transform duration-150 active:scale-[0.985] disabled:opacity-50">
          收好錢了，結帳
        </button>)}
      </footer>}
    </aside>
  );
}

function MethodPicker({ value, onChange, label = "怎麼收" }: { value: PaymentMethod; onChange: (value: PaymentMethod) => void; label?: string }) {
  return <div role="radiogroup" aria-label={label} className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
    <span className="text-ink-soft">{label}</span>
    {PAYMENT_METHODS.map((option) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value}
      onClick={() => onChange(option.value)}
      className={`h-10 rounded-full border px-3 ${value === option.value ? "border-ink bg-ink text-paper" : "border-ink/15 bg-white"}`}>{option.label}</button>)}
  </div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-ink-soft">{label}</dt><dd className="tabular-nums">{value}</dd></div>;
}

function TimeButton({ label, onClick, disabled, primary = false }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled}
    className={`h-12 rounded-xl text-sm font-semibold transition-transform duration-150 active:scale-[0.97] disabled:opacity-35 ${primary ? "bg-caramel-deep text-white" : "border border-ink/15 bg-white"}`}>{label}</button>;
}
