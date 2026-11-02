"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { responseError, thrownMessage } from "@/lib/friendly-error";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { MenuPicker } from "@/components/MenuPicker";
import { selectionProblem } from "@/lib/option-sets";
import type { MenuItem, Order, OrderItem } from "@/types";
import type { DraftItemInput } from "@/lib/reservation-preorder";
import { ENDED_STAY_STATUSES, foodStillOwed } from "@/lib/room-checkout";
import { readAddItemsOutcome } from "@/lib/add-items-outcome";
import { useAddOutcomeWarning } from "@/lib/use-add-outcome-warning";
import { AddOutcomeWarning } from "@/components/admin/AddOutcomeWarning";

type ReservationView = { customer_name: string; booking_code: string; start_time: string; status: string; room?: { name: string; branch_id: string } | { name: string; branch_id: string }[] | null };
type PreorderView = { status: string; guest_notes: string | null; draft_items: DraftItemInput[];
  requires_reconfirmation: boolean; reservation_preorder_items: Array<{ id: string; item_name_snapshot: string; quantity: number; selected_options_snapshot: Array<{ name: string }>; special_notes: string | null }> };
type View = { reservation: ReservationView; preorder: PreorderView | null; order: Order | null };

export default function ReservationOrderPage() {
  const id = String(useParams().id);
  const currentId = useRef(id);
  currentId.current = id;
  const requestSequence = useRef(0);
  const mutationInFlight = useRef(false);
  const [view, setView] = useState<View | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuError, setMenuError] = useState("");
  const [preItems, setPreItems] = useState<DraftItemInput[]>([]);
  const [preNotes, setPreNotes] = useState("");
  const [newItems, setNewItems] = useState<DraftItemInput[]>([]);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editItems, setEditItems] = useState<DraftItemInput[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const addWarning = useAddOutcomeWarning(id);

  const load = useCallback(async (): Promise<boolean> => {
    if (currentId.current !== id) return false;
    const sequence = ++requestSequence.current;
    const isCurrent = () => sequence === requestSequence.current && currentId.current === id;
    const response = await fetchWithTimeout(`/api/admin/reservation-orders/${encodeURIComponent(id)}`);
    if (!isCurrent()) return false;
    if (!response.ok) {
      const message = await responseError(response);
      if (!isCurrent()) return false;
      throw new Error(message);
    }
    const data = await readJsonWithTimeout<View>(response);
    if (!isCurrent()) return false;
    const next = data as View;
    const room = Array.isArray(next.reservation.room) ? next.reservation.room[0] : next.reservation.room;
    setView(next);
    setMenu([]);
    setMenuError("");
    setPreItems(next.preorder?.draft_items ?? []);
    setPreNotes(next.preorder?.guest_notes ?? "");
    setQuantities(Object.fromEntries((next.order?.order_items ?? []).map((item) => [item.id, item.quantity])));
    if (room?.branch_id) {
      try {
        const menuResponse = await fetchWithTimeout(`/api/menu?branchId=${encodeURIComponent(room.branch_id)}`);
        if (!menuResponse.ok) throw new Error(await responseError(menuResponse));
        const menuData = await readJsonWithTimeout<{ items?: MenuItem[] }>(menuResponse);
        if (isCurrent()) {
          setMenu((menuData.items ?? []).filter((item: MenuItem) => item.is_available));
        }
      } catch (cause) {
        if (isCurrent()) {
          setMenu([]);
          setMenuError(thrownMessage(cause, "餐點選單暫時無法載入"));
        }
      }
    }
    return isCurrent();
  }, [id]);

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    setView(null);
    setMenu([]);
    setMenuError("");
    setError("");
    load().catch((cause) => {
      if (currentId.current === id && requestSequence.current === sequence) {
        setError(thrownMessage(cause, "載入失敗，請重新整理"));
      }
    });
  }, [id, load]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (mutationInFlight.current) return false;
    if (action === "add_items" && !addWarning.confirmBeforeAdd(id)) return false;
    mutationInFlight.current = true;
    setBusy(true); setError(""); setNotice("");
    let committed = false;
    try {
      const response = await (action === "add_items" ? fetchWithTimeout : fetch)(`/api/admin/reservation-orders/${encodeURIComponent(id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }),
      });
      if (action === "add_items") {
        const outcome = await readAddItemsOutcome(response);
        if (outcome.kind !== "committed") {
          if (outcome.kind === "unknown") addWarning.mark(id, "unknown");
          if (currentId.current === id) setError(outcome.message);
          return false;
        }
        committed = true;
        await load().then((loaded) => {
          if (!loaded) addWarning.mark(id, "committed_stale");
        }).catch(() => {
          addWarning.mark(id, "committed_stale");
          if (currentId.current === id) setNotice("已加入訂單，但畫面未能更新。請重新整理頁面確認，請勿再次加點。");
        });
        return true;
      }
      if (!response.ok) throw new Error(await responseError(response));
      await load();
      return true;
    } catch (cause) {
      if (action === "add_items") addWarning.mark(id, committed ? "committed_stale" : "unknown");
      if (currentId.current === id) setError(thrownMessage(cause));
      return false;
    }
    finally { mutationInFlight.current = false; setBusy(false); }
  }

  async function addSelected() {
    if (await act("add_items", { items: newItems })) setNewItems([]);
  }

  const room = Array.isArray(view?.reservation.room) ? view?.reservation.room[0] : view?.reservation.room;
  return <main className="min-h-screen bg-stone-50 px-4 py-6 text-stone-900">
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/admin" className="text-sm font-medium text-amber-800">← 返回訂位後台</Link>
      <header className="border-b border-stone-300 pb-4">
        <h1 className="text-2xl font-semibold">訂位餐點管理</h1>
        {view && <p className="mt-2 text-sm text-stone-600">{view.reservation.customer_name} · {room?.name ?? "包廂"} · 代碼 {view.reservation.booking_code} · {new Date(view.reservation.start_time).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>}
      </header>
      <p role="status" aria-atomic="true" className={notice ? "rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900" : "sr-only"}>{notice}</p>
      <AddOutcomeWarning warning={addWarning.warning} busy={busy} onReload={() => { load().catch((cause) => setError(thrownMessage(cause))); }} />
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">{error}</p>}
      {menuError && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{menuError}</p>}
      {!view && !error && <p>載入中…</p>}
      {view && !view.order && <>
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-lg font-semibold">訂位時先點的餐 <span className="text-sm font-normal text-stone-500">還沒送到廚房</span></h2>
          {view.preorder?.requires_reconfirmation && <p className="mt-2 text-sm text-rose-700">訂位內容曾變動，請確認餐點後儲存。</p>}
          {view.preorder?.reservation_preorder_items?.length ? <ul className="mt-3 space-y-1 text-sm">
            {view.preorder.reservation_preorder_items.map((item) => <li key={item.id}>{item.item_name_snapshot} ×{item.quantity}{item.selected_options_snapshot?.length ? `（${item.selected_options_snapshot.map((option) => option.name).join("、")}）` : ""}</li>)}
          </ul> : <p className="mt-2 text-sm text-stone-500">尚未選餐。</p>}
          <div className="mt-5 border-t border-stone-100 pt-4"><h3 className="mb-3 font-semibold">店員調整預點內容</h3>
            <MenuPicker items={menu.filter((item) => item.preorder_eligible)} value={preItems} onChange={setPreItems} disabled={busy} />
            <textarea aria-label="預點餐備註" value={preNotes} onChange={(event) => setPreNotes(event.target.value)} maxLength={1000}
              className="mt-3 min-h-20 w-full rounded-lg border border-stone-300 p-2" placeholder="餐點備註" />
            {selectionProblem(menu, preItems) && <p role="alert" className="mt-2 text-sm text-rose-700">{selectionProblem(menu, preItems)}</p>}
            <button disabled={busy || Boolean(selectionProblem(menu, preItems))} onClick={() => act("save_preorder", { items: preItems, notes: preNotes })}
              className="mt-3 rounded-lg border border-amber-700 px-4 py-2 font-medium text-amber-900 disabled:opacity-50">儲存餐點調整</button>
          </div>
        </section>
        <button disabled={busy || ["cancelled", "completed"].includes(view.reservation.status) || Boolean(view.preorder?.requires_reconfirmation)}
          onClick={() => act("check_in")} className="w-full rounded-lg bg-amber-700 px-4 py-3 font-semibold text-white disabled:opacity-50">
          確認客人到店，送入備餐清單
        </button>
      </>}
      {view?.order && <>
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">現場訂單</h2>
            <span className={view.order.paid_at ? "text-emerald-700" : "text-amber-800"}>{view.order.paid_at ? "已結帳" : "未結帳"}</span></div>
          <p className="mt-1 text-sm text-stone-600">每個品項全部出完後，按該項的「標記已出餐」。</p>
          <div className="mt-4 divide-y divide-stone-200">
            {(view.order.order_items ?? []).map((item: OrderItem) => <div key={item.id} className="py-3">
              <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{item.item_name} ×{item.quantity}</p>
                {item.selected_options?.length ? <p className="text-sm text-stone-500">{item.selected_options.map((option) => option.name).join("、")}</p> : null}
                {item.special_notes && <p className="text-sm text-amber-800">備註：{item.special_notes}</p>}</div>
                <strong>NT$ {(Number(item.unit_price) * item.quantity).toLocaleString()}</strong></div>
              {item.served_at ? <p className="mt-2 text-sm font-semibold text-emerald-700">已出餐</p> : <div className="mt-3 flex flex-wrap items-center gap-2">
                <input aria-label={`${item.item_name}數量`} type="number" min={1} max={99} value={quantities[item.id] ?? item.quantity}
                  onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: Number(event.target.value) }))}
                  className="w-20 rounded border border-stone-300 px-2 py-1.5" />
                <button disabled={busy || Boolean(view.order?.paid_at)} onClick={() => act("update_quantity", { item_id: item.id, quantity: quantities[item.id] })}
                  className="rounded border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-50">改數量</button>
                <button disabled={busy || Boolean(view.order?.paid_at)} onClick={() => act("remove_item", { item_id: item.id })}
                  className="rounded border border-rose-300 px-3 py-1.5 text-sm text-rose-700 disabled:opacity-50">刪除</button>
                {item.menu_item_id && menu.some((choice) => choice.id === item.menu_item_id) && <button disabled={busy || Boolean(view.order?.paid_at)}
                  onClick={() => { setEditingItem(item.id); setEditItems([{ menu_item_id: item.menu_item_id!, quantity: item.quantity,
                    option_ids: ((item.selected_options ?? []) as Array<{ id?: string }>).map((option) => option.id).filter((option): option is string => Boolean(option)),
                    special_notes: item.special_notes ?? "" }]); }}
                  className="rounded border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-50">修改選項</button>}
                <button disabled={busy} onClick={() => act("serve_item", { item_id: item.id })}
                  className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">標記已出餐</button>
              </div>}
              {editingItem === item.id && item.menu_item_id && <div className="mt-3 rounded-lg bg-stone-50 p-3">
                <MenuPicker items={menu.filter((choice) => choice.id === item.menu_item_id)} value={editItems} onChange={setEditItems} disabled={busy} />
                <div className="mt-3 flex gap-2"><button disabled={busy || editItems.length !== 1 || Boolean(selectionProblem(menu, editItems))} onClick={async () => {
                  if (await act("replace_item", { item_id: item.id, item: editItems[0] })) setEditingItem(null);
                }} className="rounded bg-amber-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">儲存修改</button>
                  <button onClick={() => setEditingItem(null)} className="rounded border border-stone-300 px-3 py-1.5 text-sm">取消</button></div>
              </div>}
            </div>)}
            {view.order.order_items?.length === 0 && <p className="py-4 text-sm text-stone-500">尚無餐點，可從下方加入。</p>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-300 pt-4">
            <strong>餐費 NT$ {Number(view.order.total_amount).toLocaleString()}</strong>
            {/* 已離開且餐費 0 元：沒有東西可收，不給補記按鈕（#447 P2-2） */}
            {(view.order.paid_at || !(ENDED_STAY_STATUSES as readonly string[]).includes(view.reservation.status)
              || foodStillOwed(view.reservation.status, view.order.paid_at, view.order.total_amount))
              ? <button disabled={busy || Boolean(view.order.paid_at)} onClick={() => act("settle")}
                className="rounded-lg bg-stone-900 px-4 py-2 font-semibold text-white disabled:opacity-50">{view.order.paid_at ? "已結帳" : "記錄現場已結帳"}</button>
              : <span className="text-sm text-stone-500">沒有餐費要收</span>}
          </div>
        </section>
        {!view.order.paid_at && <section className="rounded-xl border border-stone-200 bg-white p-4"><h2 className="mb-3 text-lg font-semibold">現場追加餐點</h2>
          <MenuPicker items={menu} value={newItems} onChange={setNewItems} disabled={busy} />
          {selectionProblem(menu, newItems) && <p role="alert" className="mt-2 text-sm text-rose-700">{selectionProblem(menu, newItems)}</p>}
          <button disabled={busy || newItems.length === 0 || Boolean(selectionProblem(menu, newItems))} onClick={addSelected}
            className="mt-4 rounded-lg bg-amber-700 px-4 py-2 font-semibold text-white disabled:opacity-50">加入訂單</button>
        </section>}
      </>}
    </div>
  </main>;
}
