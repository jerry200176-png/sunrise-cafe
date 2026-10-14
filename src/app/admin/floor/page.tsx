"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Box, LayoutList, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { RoomCheckoutPanel } from "@/components/admin/RoomCheckoutPanel";
import { RoomFloor3D, STATUS_STYLE, fmtClock, tileHeadline, type FloorTile } from "@/components/admin/RoomFloor3D";
import { friendlyMessage } from "@/lib/friendly-error";
import { roomFloorState, type RoomFloorStatus } from "@/lib/room-checkout";
import type { FloorBundle } from "@/app/api/admin/floor/route";
import { assignRoomsToPlan, floorPlanForBranch } from "@/lib/floor-plan";

// three.js 只在這頁、只在瀏覽器載入（不影響其他頁的載入速度）
const RoomFloorScene = dynamic(() => import("@/components/admin/RoomFloorScene"), {
  ssr: false,
  loading: () => <div className="flex h-[460px] items-center justify-center rounded-[1.5rem] border border-ink/10 bg-paper text-sm text-ink-faint sm:h-[540px]">立體圖載入中…</div>,
});

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

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
  const [webgl, setWebgl] = useState(false);
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const currentBranch = useRef("");
  const loadSeq = useRef(0);

  useEffect(() => {
    setWebgl(supportsWebGL());
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "3d" || saved === "list") setView(saved);
      else if (window.matchMedia("(max-width: 640px)").matches) setView("list");
    } catch { /* storage unavailable */ }
    void loadBranches();
  }, []);

  // 只列出這個帳號能管的分店（店長／店員可能只負責一間）
  async function loadBranches() {
    try {
      const [branchRes, meRes] = await Promise.all([
        fetch("/api/branches", { credentials: "include" }),
        fetch("/api/admin/me", { credentials: "include" }),
      ]);
      if (!branchRes.ok) throw new Error(friendlyMessage((await branchRes.json().catch(() => ({}))).error, branchRes.status));
      const rows = (await branchRes.json()) as Branch[];
      // 查不到權限範圍就不顯示任何分店（不可當成「全部分店」）
      if (!meRes.ok) throw new Error(friendlyMessage((await meRes.json().catch(() => ({}))).error, meRes.status));
      const me = (await meRes.json()) as { branch_ids: string[] | null };
      const list = (Array.isArray(rows) ? rows : []).filter((branch) => me.branch_ids === null || me.branch_ids.includes(branch.id));
      setBranches(list);
      setBranchesLoaded(true);
      if (list[0]) setBranchId(list[0].id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error && /[一-鿿]/.test(cause.message) ? cause.message : "無法載入分店，請按右上角重新整理");
    }
  }

  const load = useCallback(async () => {
    if (!branchId) return;
    const requested = branchId;
    // 同一分店的請求也可能交錯（30 秒輪詢 vs. 操作後重新整理）：只套用最新發出的那一次
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/floor?branchId=${encodeURIComponent(requested)}`, { credentials: "include" });
      const json = await response.json();
      // 切換分店後，舊分店晚回來的資料直接丟掉，避免在 B 店畫面操作到 A 店的客人
      if (currentBranch.current !== requested || seq !== loadSeq.current) return;
      if (!response.ok) throw new Error(friendlyMessage(json.error, response.status));
      setData(json as FloorBundle);
      setError(null);
    } catch (cause) {
      if (currentBranch.current === requested && seq === loadSeq.current) setError(cause instanceof Error ? cause.message : "載入失敗，請重試");
    } finally {
      if (currentBranch.current === requested) { setLoading(false); setNow(Date.now()); }
    }
  }, [branchId]);

  useEffect(() => {
    currentBranch.current = branchId;
    setData(null);
    setSelectedRoom(null);
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
    // 還沒送的餐、還沒收的餐費都跟著包廂算，不只看目前這組（結帳後客人可能還在等餐；舊的「已完成」按鈕不會記收款）
    const roomReservationIds = new Set((data?.reservations ?? []).filter((r) => r.room_id === room.id).map((r) => r.id));
    const roomOrders = (data?.orders ?? []).filter((o) => roomReservationIds.has(o.reservation_id));
    return {
      id: room.id, name: room.name, capacity: room.capacity, state,
      foodTotal: roomOrders.filter((o) => !o.paid_at).reduce((sum, o) => sum + o.total_amount, 0),
      unserved: roomOrders.reduce((sum, o) => sum + o.unserved_count, 0),
    };
  }), [data, now]);

  const counts = useMemo(() => {
    const by = (status: RoomFloorStatus) => tiles.filter((t) => t.state.status === status).length;
    return { inUse: by("in_use") + by("ending_soon") + by("overtime"), overtime: by("overtime"), arriving: by("awaiting") + by("upcoming"),
      idle: by("idle"), food: tiles.reduce((sum, t) => sum + t.foodTotal, 0) };
  }, [tiles]);

  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? null;
  const plan = useMemo(() => floorPlanForBranch(branchName), [branchName]);
  const slots = useMemo(() => (plan && data ? assignRoomsToPlan(plan, data.rooms) : null), [plan, data]);

  const selected = tiles.find((t) => t.id === selectedRoom) ?? null;
  // 這間包廂裡「不是目前這組」但還沒處理完的：還在包廂裡（已報到）的上一組一定要能結帳，
  // 其他（結帳完、報到後取消、用舊按鈕完成的）則看是否還有沒送完的餐或沒收的餐費
  const leftovers = selected
    ? (data?.reservations ?? []).filter((r) => r.room_id === selected.id && r.id !== selected.state.current?.id
      && (r.status === "checked_in"
        || (data?.orders ?? []).some((o) => o.reservation_id === r.id && (o.unserved_count > 0 || !o.paid_at))))
    : [];
  const [openReservationId, setOpenReservationId] = useState<string | null>(null);
  useEffect(() => { setOpenReservationId(null); }, [selectedRoom]);
  const defaultReservation = selected?.state.current ?? leftovers[0] ?? selected?.state.next ?? null;
  const selectedReservation = (openReservationId && (data?.reservations ?? []).find((r) => r.id === openReservationId)) || defaultReservation;
  const sortedTiles = [...tiles].sort((a, b) => ATTENTION.indexOf(a.state.status) - ATTENTION.indexOf(b.state.status));

  return (
    <AdminShell
      title="包廂現況"
      subtitle={`現在 ${fmtClock(new Date(now).toISOString())} · 點一間包廂就能點餐、延長、結帳`}
      maxWidth="5xl"
      actions={<button type="button" onClick={() => void (branchId ? load() : loadBranches())} disabled={loading} aria-label="重新整理"
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
          <Kpi label="等客人到" value={counts.arriving} />
          <Kpi label="空房" value={counts.idle} />
          <Kpi label="還沒收的餐費" value={`NT$ ${counts.food.toLocaleString()}`} wide />
        </div>

        <div className="flex items-center justify-between gap-2">
          <ul className="flex flex-wrap gap-1.5 text-[11px]" aria-label="圖例">
            {(Object.keys(STATUS_STYLE) as RoomFloorStatus[]).map((status) => <li key={status} className="flex items-center gap-1 rounded-full border border-ink/10 bg-white/70 px-2 py-0.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_STYLE[status].front }} />{STATUS_STYLE[status].label}
            </li>)}
          </ul>
          <div className="flex shrink-0 rounded-xl border border-ink/10 bg-white p-0.5" role="group" aria-label="顯示方式">
            <ViewButton active={view === "3d"} onClick={() => chooseView("3d")} label="立體圖"><Box className="h-4 w-4" strokeWidth={1.5} /></ViewButton>
            <ViewButton active={view === "list"} onClick={() => chooseView("list")} label="清單"><LayoutList className="h-4 w-4" strokeWidth={1.5} /></ViewButton>
          </div>
        </div>

        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        {branchesLoaded && branches.length === 0 && <p className="py-10 text-center text-sm text-stone-500">你的帳號目前沒有負責的分店，請找老闆設定。</p>}
        {!data && !error && !(branchesLoaded && branches.length === 0) && <p className="py-10 text-center text-sm text-stone-500">載入中…</p>}
        {data && tiles.length === 0 && <p className="py-10 text-center text-sm text-stone-500">此分店尚未建立包廂。</p>}

        {tiles.length > 0 && (view === "3d"
          ? plan && slots && webgl
            ? <RoomFloorScene plan={plan} tiles={tiles} slots={slots} selectedId={selectedRoom} onSelect={setSelectedRoom} />
            : <RoomFloor3D tiles={tiles} selectedId={selectedRoom} onSelect={setSelectedRoom} />
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
                    <span className="block truncate text-sm text-ink-soft">{tile.state.current?.customer_name ?? (tile.state.next ? `下一組：${tile.state.next.customer_name}` : "今天沒有客人")}</span>
                  </span>
                  <span className="text-right text-sm">
                    <span className={`block font-medium ${tile.state.status === "overtime" ? "text-rose-700" : ""}`}>{tileHeadline(tile)}</span>
                    {tile.foodTotal > 0 && <span className="block text-xs text-caramel-deep">餐費 NT$ {tile.foodTotal.toLocaleString()}</span>}
                    {tile.unserved > 0 && <span className="block text-xs text-emerald-800">還有 {tile.unserved} 份沒送</span>}
                  </span>
                </button>
              </li>;
            })}
          </ul>)}
      </div>

      {selected && <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`${selected.name} 結帳`}>
        <button type="button" aria-label="關閉面板" className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={() => setSelectedRoom(null)} />
        <div className="relative flex h-full w-full max-w-lg flex-col shadow-2xl sm:rounded-l-[1.5rem] sm:overflow-hidden">
          {selectedReservation && (openReservationId || leftovers.some((r) => r.id !== selectedReservation.id)) && <div className="flex flex-wrap gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm">
            {leftovers.some((r) => r.id !== selectedReservation.id) && <span className="text-amber-900">這間還有別組的單沒處理完：</span>}
            {leftovers.filter((r) => r.id !== selectedReservation.id).map((r) => <button key={r.id} type="button" onClick={() => setOpenReservationId(r.id)}
              className="rounded-full border border-amber-300 bg-white px-3 py-0.5 text-amber-900">{r.customer_name}</button>)}
            {openReservationId && <button type="button" onClick={() => setOpenReservationId(null)} className="rounded-full px-3 py-0.5 text-ink-soft underline">回到目前這組</button>}
          </div>}
          <div className="min-h-0 flex-1">
          {selectedReservation
            ? <RoomCheckoutPanel reservationId={selectedReservation.id} roomName={selected.name} branchId={branchId} nowMs={now}
              onClose={() => setSelectedRoom(null)} onChanged={() => void load()} />
            : <div className="flex h-full flex-col items-center justify-center gap-3 bg-paper p-8 text-center">
              <p className="font-serif text-xl">{selected.name}</p>
              <p className="text-sm text-ink-soft">這間今天沒有預約。現場來的客人，請先到「訂位」幫他登記。</p>
              <div className="flex gap-2">
                <a href="/admin" className="flex h-11 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-paper">去登記客人</a>
                <button type="button" onClick={() => setSelectedRoom(null)} className="h-11 rounded-xl border border-ink/15 px-4 text-sm">關閉</button>
              </div>
            </div>}
          </div>
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
