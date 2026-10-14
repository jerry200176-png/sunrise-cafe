"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { RoomFloorState, RoomFloorStatus } from "@/lib/room-checkout";

export type FloorTile = {
  id: string;
  name: string;
  capacity: number;
  state: RoomFloorState;
  /** 未結帳餐費（現場訂單） */
  foodTotal: number;
  unserved: number;
};

/** 暖色系、低彩度（DESIGN.md）：top / front / side 三面由亮到暗。 */
export const STATUS_STYLE: Record<RoomFloorStatus, { label: string; top: string; front: string; side: string; height: number; chip: string }> = {
  idle: { label: "空房", top: "#f1e9da", front: "#e3d5bd", side: "#d6c6aa", height: 10, chip: "bg-stone-100 text-stone-600" },
  upcoming: { label: "快到了", top: "#f6e2bd", front: "#ebcd96", side: "#ddba7c", height: 16, chip: "bg-amber-50 text-amber-800" },
  awaiting: { label: "客人還沒到", top: "#f0c27a", front: "#dcaa5e", side: "#c9964a", height: 22, chip: "bg-amber-100 text-amber-900" },
  in_use: { label: "使用中", top: "#d3dec7", front: "#b9caa9", side: "#a5b894", height: 34, chip: "bg-emerald-50 text-emerald-800" },
  ending_soon: { label: "快到時間", top: "#e8b267", front: "#d39a4c", side: "#c0832f", height: 34, chip: "bg-orange-100 text-orange-900" },
  overtime: { label: "超時", top: "#ebb3a6", front: "#d99282", side: "#c77a69", height: 40, chip: "bg-rose-100 text-rose-800" },
};

export function fmtClock(iso: string) {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function minutesText(minutes: number) {
  const abs = Math.abs(minutes);
  const text = abs >= 60 ? `${Math.floor(abs / 60)} 小時 ${abs % 60} 分` : `${abs} 分`;
  return minutes < 0 ? `超時 ${text}` : `剩 ${text}`;
}

export function tileHeadline(tile: FloorTile): string {
  const { state } = tile;
  if (state.current && state.minutesLeft !== null && state.status !== "awaiting") return minutesText(state.minutesLeft);
  if (state.current) return `${fmtClock(state.current.start_time)} 應到`;
  if (state.next) return `下一組 ${fmtClock(state.next.start_time)}`;
  return "今天沒有客人";
}

/**
 * 等角 3D 包廂圖（純 CSS 3D）：沒有平面圖設定或瀏覽器不支援 WebGL 時使用。
 * 方塊高度＝忙碌程度；標籤在平面覆蓋層，依方塊頂面投影位置定位。
 */
export function RoomFloor3D({ tiles, selectedId, onSelect }: {
  tiles: FloorTile[];
  selectedId: string | null;
  onSelect: (roomId: string) => void;
}) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(tiles.length)));
  const stage: CSSProperties = { transform: "rotateX(55deg) rotateZ(45deg)", transformStyle: "preserve-3d" };
  const frame = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<Record<string, { x: number; y: number }>>({});

  // 標籤放在平面覆蓋層（不參與 3D 深度排序，不會被後方方塊遮住），位置取自各方塊頂面的實際投影。
  useLayoutEffect(() => {
    const root = frame.current;
    if (!root) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const next: Record<string, { x: number; y: number }> = {};
      root.querySelectorAll<HTMLElement>("[data-room-top]").forEach((el) => {
        const r = el.getBoundingClientRect();
        next[el.dataset.roomTop!] = { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
      });
      setAnchors(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.addEventListener("transitionend", measure);
    return () => { observer.disconnect(); root.removeEventListener("transitionend", measure); };
  }, [tiles, selectedId]);

  return (
    <div ref={frame} className="relative overflow-hidden rounded-[1.5rem] border border-ink/10 bg-gradient-to-b from-paper to-paper-deep px-4 pb-12 pt-28 [perspective:1800px]">
      <div className="mx-auto w-fit" style={stage}>
        <div
          className="grid gap-12 rounded-[1.25rem] p-8"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            transformStyle: "preserve-3d",
            background: "repeating-linear-gradient(0deg, rgba(43,32,24,0.05) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(43,32,24,0.05) 0 1px, transparent 1px 28px), #efe6d6",
            boxShadow: "0 40px 60px -30px rgba(157,101,25,0.35)",
          }}
        >
          {tiles.map((tile) => (
            <RoomBlock key={tile.id} tile={tile} selected={tile.id === selectedId} onSelect={() => onSelect(tile.id)} />
          ))}
        </div>
      </div>
      {tiles.map((tile) => anchors[tile.id] && (
        <RoomLabel key={tile.id} tile={tile} selected={tile.id === selectedId} at={anchors[tile.id]} onSelect={() => onSelect(tile.id)} />
      ))}
    </div>
  );
}

function RoomLabel({ tile, selected, at, onSelect }: { tile: FloorTile; selected: boolean; at: { x: number; y: number }; onSelect: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={onSelect}
      className="absolute z-10 -translate-x-1/2 -translate-y-full pb-1 text-left"
      style={{ left: at.x, top: at.y }}
    >
      <RoomLabelCard tile={tile} selected={selected} />
      <span className="mx-auto block h-2.5 w-px bg-ink/40" />
    </button>
  );
}

/** 包廂浮動標籤（CSS 立體圖與 three.js 立體圖共用） */
export function RoomLabelCard({ tile, selected, compact = false }: { tile: FloorTile; selected: boolean; compact?: boolean }) {
  const style = STATUS_STYLE[tile.state.status];
  return (
    <span className={`block w-max max-w-[11rem] rounded-xl border bg-white/95 px-2.5 py-1.5 text-left shadow-[0_10px_24px_-14px_rgba(43,32,24,0.55)] ${selected ? "border-caramel" : "border-ink/10"}`}>
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <strong className="font-serif text-[13px] text-ink">{tile.name}</strong>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${style.chip}`}>{style.label}</span>
      </span>
      {!compact && tile.state.current && <span className="block truncate text-[11px] text-ink-soft">{tile.state.current.customer_name}{tile.state.current.guest_count ? ` · ${tile.state.current.guest_count} 人` : ""}</span>}
      <span className={`block whitespace-nowrap text-[11px] font-medium ${tile.state.status === "overtime" ? "text-rose-700" : "text-ink-soft"}`}>{tileHeadline(tile)}</span>
      {!compact && tile.foodTotal > 0 && <span className="block whitespace-nowrap text-[10px] text-caramel-deep">餐費 NT$ {tile.foodTotal.toLocaleString()}{tile.unserved > 0 ? ` · 還有 ${tile.unserved} 份沒送` : ""}</span>}
    </span>
  );
}

function RoomBlock({ tile, selected, onSelect }: { tile: FloorTile; selected: boolean; onSelect: () => void }) {
  const style = STATUS_STYLE[tile.state.status];
  const big = tile.capacity >= 8;
  const w = big ? 150 : 112;
  const d = 112;
  const h = style.height + (selected ? 8 : 0);
  const face = "absolute transition-transform duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${tile.name}：${style.label}，${tileHeadline(tile)}`}
      aria-pressed={selected}
      className="group relative focus:outline-none"
      style={{ width: w, height: d, transformStyle: "preserve-3d" }}
    >
      {/* floor shadow */}
      <span className="absolute inset-0 rounded-md bg-ink/10 blur-[6px]" />
      {/* front (+y) face */}
      <span className={face} style={{ left: 0, top: "100%", width: w, height: h, background: style.front, transformOrigin: "top", transform: "rotateX(90deg)" }} />
      {/* side (+x) face */}
      <span className={face} style={{ left: "100%", top: 0, width: h, height: d, background: style.side, transformOrigin: "left", transform: "rotateY(-90deg)" }} />
      {/* top face */}
      <span
        className={`${face} inset-0 rounded-[3px] ${selected ? "ring-4 ring-caramel" : "group-hover:ring-2 group-hover:ring-caramel/60 group-focus-visible:ring-4 group-focus-visible:ring-caramel"} ${tile.state.status === "overtime" ? "motion-safe:animate-pulse" : ""}`}
        style={{ background: style.top, transform: `translateZ(${h}px)` }}
        data-room-top={tile.id}
      />
    </button>
  );
}
