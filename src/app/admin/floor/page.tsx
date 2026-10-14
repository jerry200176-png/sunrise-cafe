"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, LayoutList, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { RoomCheckoutPanel } from "@/components/admin/RoomCheckoutPanel";
import { RoomFloor3D, STATUS_STYLE, fmtClock, tileHeadline, type FloorTile } from "@/components/admin/RoomFloor3D";
import { friendlyMessage } from "@/lib/friendly-error";
import { roomFloorState, type RoomFloorStatus } from "@/lib/room-checkout";
import type { FloorBundle } from "@/app/api/admin/floor/route";

type Branch = { id: string; name: string };
const VIEW_KEY = "sunrise.floor.view";
const ATTENTION: RoomFloorStatus[] = ["overtime", "awaiting", "ending_soon", "upcoming", "in_use", "idle"];

export default function FloorConsolePage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [data, setData] = useState<FloorBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<"3d" | "list">("3d");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "3d" || saved === "list") setView(saved);
      else if (window.matchMedia("(max-width: 640px)").matches) setView("list");
    } catch { /* storage unavailable */ }
    fetch("/api/branches", { credentials: "include" })
      .then((response) => response.json())
      .then((rows: Branch[]) => {
        const list = Array.isArray(rows) ? rows : [];
        setBranches(list);
        if (list[0]) setBranchId(list[0].id);
      })
      .catch(() => setError("無法載入分店，請重新整理"));
  }, []);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/floor?branchId=${encodeURIComponent(branchId)}`, { credentials: "include" });
      const json = await response.json();
      if (!response.ok) throw new Error(friendlyMessage(json.error, response.status));
      setData(json as FloorBundle);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "載入失敗，請重試");
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, [branchId]);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { window.clearInterval(refresh); window.clearInterval(tick); };
  }, [load]);

  function chooseView(next: "3d" | "list") {
    setView(next);
    try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* storage unavailable */ }
  }

  const tiles: FloorTile[] = useMemo(() => (data?.rooms ?? []).map((room) => {
    const state = roomFloorState((data?.reservations ?? []).filter((r) => r.room_id === room.id), now);
    const order = state.current ? data?.orders.find((o) => o.reservation_id === state.current!.id) : undefined;
    return {
      id: room.id, name: room.name, capacity: room.capacity, state,
      foodTotal: order && !order.paid_at ? order.total_amount : 0,
      unserved: order?.unserved_count ?? 0,
    };
  }), [data, now]);

  const counts = useMemo(() => {
    const by = (status: RoomFloorStatus) => tiles.filter((t) => t.state.status === status).length;
    return { inUse: by("in_use") + by("ending_soon") + by("overtime"), overtime: by("overtime"), arriving: by("awaiting") + by("upcoming"),
      idle: by("idle"), food: tiles.reduce((sum, t) => sum + t.foodTotal, 0) };
  }, [tiles]);

  const selected = tiles.find((t) => t.id === selectedRoom) ?? null;
  const selectedReservation = selected?.state.current ?? selected?.state.next ?? null;
  const sortedTiles = [...tiles].sort((a, b) => ATTENTION.indexOf(a.state.status) - ATTENTION.indexOf(b.state.status));

  return (
    <AdminShell
      title="包廂場控"
      subtitle={`${fmtClock(new Date(now).toISOString())} · 點包廂即可點餐、延時、結帳`}
      maxWidth="5xl"
      actions={<button type="button" onClick={() => void load()} disabled={loading} aria-label="重新整理"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100 disabled:opacity-50">
        <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.5} />
      </button>}
      headerExtra={branches.length > 1 ? <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setSelectedRoom(null); }}
        aria-label="分店" className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm focus:border-amber-500 focus:outline-none">
        {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select> : undefined}
    >
      <div className="space-y-4 pb-24">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Kpi label="使用中" value={counts.inUse} />
          <Kpi label="超時" value={counts.overtime} tone={counts.overtime ? "alert" : undefined} />
          <Kpi label="即將/應到" value={counts.arriving} />
          <Kpi label="空房" value={counts.idle} />
          <Kpi label="未結餐費" value={`NT$ ${counts.food.toLocaleString()}`} wide />
        </div>

        <div className="flex items-center justify-between gap-2">
          <ul className="flex flex-wrap gap-1.5 text-[11px]" aria-label="圖例">
            {(Object.keys(STATUS_STYLE) as RoomFloorStatus[]).map((status) => <li key={status} className="flex items-center gap-1 rounded-full border border-ink/10 bg-white/70 px-2 py-0.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_STYLE[status].front }} />{STATUS_STYLE[status].label}
            </li>)}
          </ul>
          <div className="flex shrink-0 rounded-xl border border-ink/10 bg-white p-0.5" role="group" aria-label="顯示方式">
            <ViewButton active={view === "3d"} onClick={() => chooseView("3d")} label="3D"><Box className="h-4 w-4" strokeWidth={1.5} /></ViewButton>
            <ViewButton active={view === "list"} onClick={() => chooseView("list")} label="列表"><LayoutList className="h-4 w-4" strokeWidth={1.5} /></ViewButton>
          </div>
        </div>

        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        {!data && !error && <p className="py-10 text-center text-sm text-stone-500">載入中…</p>}
        {data && tiles.length === 0 && <p className="py-10 text-center text-sm text-stone-500">此分店尚未建立包廂。</p>}

        {tiles.length > 0 && (view === "3d"
          ? <RoomFloor3D tiles={tiles} selectedId={selectedRoom} onSelect={setSelectedRoom} />
          : <ul className="grid gap-2 sm:grid-cols-2">
            {sortedTiles.map((tile) => {
              const style = STATUS_STYLE[tile.state.status];
              return <li key={tile.id}>
                <button type="button" onClick={() => setSelectedRoom(tile.id)} aria-pressed={tile.id === selectedRoom}
                  className={`flex w-full items-center gap-3 rounded-2xl border bg-white p-3 text-left ${tile.id === selectedRoom ? "border-caramel ring-2 ring-caramel/40" : "border-ink/10"}`}>
                  <span className="h-12 w-1.5 shrink-0 rounded-full" style={{ background: style.side }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><strong className="font-serif">{tile.name}</strong>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${style.chip}`}>{style.label}</span></span>
                    <span className="block truncate text-sm text-ink-soft">{tile.state.current?.customer_name ?? (tile.state.next ? `下一組：${tile.state.next.customer_name}` : "—")}</span>
                  </span>
                  <span className="text-right text-sm">
                    <span className={`block font-medium ${tile.state.status === "overtime" ? "text-rose-700" : ""}`}>{tileHeadline(tile)}</span>
                    {tile.foodTotal > 0 && <span className="block text-xs text-caramel-deep">餐 NT$ {tile.foodTotal.toLocaleString()}</span>}
                  </span>
                </button>
              </li>;
            })}
          </ul>)}
      </div>

      {selected && <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`${selected.name} 結帳`}>
        <button type="button" aria-label="關閉面板" className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={() => setSelectedRoom(null)} />
        <div className="relative h-full w-full max-w-lg shadow-2xl sm:rounded-l-[1.5rem] sm:overflow-hidden">
          {selectedReservation
            ? <RoomCheckoutPanel reservationId={selectedReservation.id} roomName={selected.name} branchId={branchId} nowMs={now}
              onClose={() => setSelectedRoom(null)} onChanged={() => void load()} />
            : <div className="flex h-full flex-col items-center justify-center gap-3 bg-paper p-8 text-center">
              <p className="font-serif text-xl">{selected.name}</p>
              <p className="text-sm text-ink-soft">今天目前沒有訂位。現場客人請先到「訂位」新增。</p>
              <div className="flex gap-2">
                <a href="/admin" className="flex h-11 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-paper">新增訂位</a>
                <button type="button" onClick={() => setSelectedRoom(null)} className="h-11 rounded-xl border border-ink/15 px-4 text-sm">關閉</button>
              </div>
            </div>}
        </div>
      </div>}
    </AdminShell>
  );
}

function Kpi({ label, value, tone, wide = false }: { label: string; value: number | string; tone?: "alert"; wide?: boolean }) {
  return <div className={`rounded-2xl border px-3 py-2.5 ${wide ? "col-span-2 sm:col-span-1 " : ""}${tone === "alert" ? "border-rose-200 bg-rose-50" : "border-ink/10 bg-white/80"}`}>
    <p className="text-[11px] text-ink-faint">{label}</p>
    <p className={`text-xl font-semibold tabular-nums ${tone === "alert" ? "text-rose-700" : "text-ink"}`}>{value}</p>
  </div>;
}

function ViewButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active}
    className={`flex h-9 items-center gap-1 rounded-lg px-3 text-sm ${active ? "bg-ink text-paper" : "text-ink-soft"}`}>{children}{label}</button>;
}
