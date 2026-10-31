"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, CheckCircle, ChefHat, Bell, LogOut } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { supabase } from "@/lib/supabase";
import { responseError, thrownMessage } from "@/lib/friendly-error";
import { useAdminBranches } from "@/lib/use-admin-branches";
import { fetchAdminOrderStatus, fetchAllAdminOrders } from "@/lib/admin-orders-fetch";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { Order, OrderStatus } from "@/types";

const ACTIVE_STATUSES: OrderStatus[] = ["pending", "preparing", "ready"];
type Review = { branch: string; kind: "unknown" | "stale"; verified: boolean; status?: OrderStatus };
const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "待處理", preparing: "準備中", ready: "完成出餐", completed: "已出餐", cancelled: "已取消",
};

export default function AdminOrdersPage() {
  const { branches, loading: branchesLoading, error: branchesError, retry: retryBranches } = useAdminBranches();
  const [branchId, setBranchId] = useState<string>("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevOrderIds = useRef<Set<string>>(new Set());
  const requestSeq = useRef(0);
  const mutationVersion = useRef(0);
  const reviewGeneration = useRef(0);
  const branchGeneration = useRef(0);
  const actionLocks = useRef(new Set<string>());
  const reviews = useRef(new Map<string, Review>());
  const [lockedOrders, setLockedOrders] = useState<Set<string>>(new Set());
  const [reviewState, setReviewState] = useState<Map<string, Review>>(new Map());
  const currentBranch = useRef("");
  const inFlight = useRef<{ branch: string; queued: boolean } | null>(null);

  useEffect(() => {
    if (branches.length && !branchId) setBranchId(branches[0].id);
  }, [branches, branchId]);

  const loadOrders = useCallback(async function load(bid: string) {
    if (!bid || currentBranch.current !== bid) return;
    reviewGeneration.current++;
    let revoked = false;
    for (const [id, review] of reviews.current) {
      if (review.branch === bid && review.verified) {
        reviews.current.set(id, { ...review, verified: false, status: undefined });
        revoked = true;
      }
    }
    if (revoked) setReviewState(new Map(reviews.current));
    if (inFlight.current?.branch === bid) {
      inFlight.current.queued = true;
      return;
    }
    const run = { branch: bid, queued: false };
    inFlight.current = run;
    const seq = ++requestSeq.current;
    const version = mutationVersion.current;
    const reviewVersion = reviewGeneration.current;
    setLoading(true);
    try {
      const data = await fetchAllAdminOrders(bid, () => seq === requestSeq.current && currentBranch.current === bid, "active");
      if (seq !== requestSeq.current || currentBranch.current !== bid) return;
      if (version !== mutationVersion.current) {
        run.queued = true;
        return;
      }
      if (!Array.isArray(data)) throw new Error("訂單資料格式不正確，請重試");
      let active = (Array.isArray(data) ? data : []).filter((o: Order) =>
        ACTIVE_STATUSES.includes(o.status)
      );
      const toReview = [...reviews.current.entries()].filter(([, review]) => review.branch === bid);
      const checked = await Promise.all(toReview.map(async ([id, review]) => {
        try { return { id, review, row: await fetchAdminOrderStatus(bid, id) }; }
        catch { return { id, review, row: null }; }
      }));
      if (seq !== requestSeq.current || currentBranch.current !== bid) return;
      if (version !== mutationVersion.current) { run.queued = true; return; }
      if (reviewVersion !== reviewGeneration.current) {
        run.queued = true;
      } else {
        for (const { id, review, row } of checked) {
          if (!row || reviews.current.get(id) !== review) continue;
          const isActive = ACTIVE_STATUSES.includes(row.status);
          const listHasRow = active.some((order) => order.id === id);
          active = active.flatMap((order) => order.id !== id ? [order] : isActive ? [{ ...order, status: row.status }] : []);
          if (review.kind === "stale" && (!isActive || listHasRow)) {
            reviews.current.delete(id);
            actionLocks.current.delete(id);
          } else {
            reviews.current.set(id, { ...review, verified: true, status: row.status });
          }
        }
      }
      setLockedOrders(new Set(actionLocks.current));
      setReviewState(new Map(reviews.current));
      setOrders(active);
      setLoadError(null);
      setLastUpdated(
        new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Taipei" })
      );
    } catch (err) {
      if (seq === requestSeq.current && currentBranch.current === bid) setLoadError(thrownMessage(err));
    } finally {
      if (inFlight.current === run) inFlight.current = null;
      if (seq === requestSeq.current && currentBranch.current === bid) {
        setLoading(false);
        if (run.queued) void load(bid);
      }
    }
  }, []);

  useEffect(() => {
    if (currentBranch.current !== branchId) {
      inFlight.current = null;
      requestSeq.current++;
      branchGeneration.current++;
    }
    currentBranch.current = branchId;
    setOrders([]);
    setLastUpdated(null);
    setLoadError(null);
    if (!branchId) return;
    loadOrders(branchId);
    const timer = window.setInterval(() => loadOrders(branchId), 15000);
    return () => window.clearInterval(timer);
  }, [branchId, loadOrders]);

  // Supabase Realtime 訂閱
  useEffect(() => {
    if (!branchId) return;

    const channel = supabase
      .channel(`orders-${branchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `branch_id=eq.${branchId}` },
        () => {
          loadOrders(branchId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [branchId, loadOrders]);

  // 偵測新訂單 → 播放音效
  useEffect(() => {
    const currentIds = new Set(orders.map((o) => o.id));
    const isNewOrder = orders.some((o) => !prevOrderIds.current.has(o.id));
    if (isNewOrder && prevOrderIds.current.size > 0) {
      if (soundOn) audioRef.current?.play().catch(() => {});
    }
    prevOrderIds.current = currentIds;
  }, [orders, soundOn]);

  const updateStatus = async (id: string, status: OrderStatus) => {
    const bid = currentBranch.current;
    if (!bid || actionLocks.current.has(id)) return;
    const generation = branchGeneration.current;
    actionLocks.current.add(id);
    setLockedOrders(new Set(actionLocks.current));
    const holdForReview = (kind: Review["kind"]) => {
      reviews.current.set(id, { branch: bid, kind, verified: false });
      setReviewState(new Map(reviews.current));
      if (currentBranch.current === bid) {
        mutationVersion.current++;
        void loadOrders(bid);
      }
    };
    try {
      const res = await fetchWithTimeout(`/api/admin/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const message = await responseError(res);
        if (currentBranch.current === bid) setActionError(`訂單操作結果尚未確認：${message}`);
        holdForReview("unknown");
        return;
      }
    } catch (err) {
      if (currentBranch.current === bid) setActionError(`訂單操作結果尚未確認：${thrownMessage(err)}`);
      holdForReview("unknown");
      return;
    }
    if (branchGeneration.current !== generation || currentBranch.current !== bid) {
      holdForReview("stale");
      return;
    }
    actionLocks.current.delete(id);
    setLockedOrders(new Set(actionLocks.current));
    mutationVersion.current++;
    setActionError(null);
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status } : o)).filter((o) =>
        ACTIVE_STATUSES.includes(o.status)
      )
    );
    void loadOrders(bid);
  };

  const releaseReviewedOrder = (id: string) => {
    const review = reviews.current.get(id);
    if (!review || review.kind !== "unknown" || !review.verified || review.branch !== currentBranch.current) return;
    if (!window.confirm("請先核對後台狀態與現場。原請求可能仍會延遲完成；解除後再次操作可能重複。確認已核對並解除鎖定？")) return;
    reviews.current.delete(id);
    actionLocks.current.delete(id);
    setReviewState(new Map(reviews.current));
    setLockedOrders(new Set(actionLocks.current));
    if (![...reviews.current.values()].some((item) => item.branch === currentBranch.current)) setActionError(null);
  };

  const pendingOrders = orders.filter((o) => o.status === "pending");
  const preparingOrders = orders.filter((o) => o.status === "preparing");
  const readyOrders = orders.filter((o) => o.status === "ready");

  return (
    <main className="min-h-screen bg-gray-50">
      {/* 新訂單提示音；瀏覽器規定要先點一下才能出聲，所以有「開啟提示音」按鈕 */}
      <audio ref={audioRef} src="/sounds/new-order.wav" preload="auto" />

      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-gray-600 hover:text-gray-900">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <ChefHat className="h-5 w-5 text-amber-600" />
              即時訂單看板
            </h1>
            {pendingOrders.length > 0 && (
              <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white animate-pulse">
                {pendingOrders.length} 待處理
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={branchId}
              onChange={(e) => {
                if (currentBranch.current === e.target.value) return;
                inFlight.current = null;
                currentBranch.current = e.target.value;
                requestSeq.current++;
                branchGeneration.current++;
                setOrders([]);
                setLastUpdated(null);
                setLoadError(null);
                setActionError(null);
                setBranchId(e.target.value);
              }}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                if (next) audioRef.current?.play().catch(() => {});
              }}
              aria-pressed={soundOn}
              className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm ${soundOn ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}
            >
              <Bell className="h-4 w-4" />
              {soundOn ? "提示音已開" : "開啟提示音"}
            </button>
            <button
              type="button"
              onClick={() => loadOrders(branchId)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              aria-label="重新整理"
              title="重新整理"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/admin/logout", { method: "POST" });
                window.location.href = "/admin/login";
              }}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50"
            >
              <LogOut className="h-4 w-4" /> 登出
            </button>
          </div>
        </div>
      </header>
      {branchesError && <p role="alert" className="mx-auto max-w-7xl border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        無法載入分店：{branchesError} <button type="button" className="ml-2 underline" onClick={() => void retryBranches()}>重試</button>
      </p>}
      {!branchesLoading && !branchesError && branches.length === 0 && <p role="status" className="mx-auto max-w-7xl px-4 py-6 text-center text-sm text-gray-500">目前沒有可管理的分店。</p>}
      {loadError && (
        <p role="alert" className="mx-auto max-w-7xl border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          訂單沒有更新成功{lastUpdated ? `（畫面是 ${lastUpdated} 的資料）` : ""}：{loadError}
        </p>
      )}
      {!loadError && lastUpdated && (
        <p className="mx-auto max-w-7xl px-4 pt-2 text-xs text-gray-400">更新於 {lastUpdated}，每 15 秒自動更新</p>
      )}
      {actionError && (
        <p role="alert" className="mx-auto max-w-7xl border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{actionError}</p>
      )}
      {[...reviewState.entries()].filter(([, review]) => review.branch === branchId).map(([id, review]) => (
        <div key={id} role="alert" className="mx-auto max-w-7xl border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          訂單 {id} 的操作需要重新核對；{review.verified && review.status ? `目前後台狀態：${STATUS_LABELS[review.status]}。請核對現場；原請求可能仍會延遲完成。` : "核對尚未完成，請保持鎖定並重新整理。"}
          {review.kind === "unknown" && <button type="button" disabled={!review.verified} onClick={() => releaseReviewedOrder(id)} className="ml-2 underline disabled:opacity-50">已核對，解除鎖定</button>}
        </div>
      ))}

      <div className="mx-auto max-w-7xl px-4 py-4">
        {/* 看板三欄 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 待處理 */}
          <KanbanColumn
            title="待處理"
            count={pendingOrders.length}
            accentColor="yellow"
            orders={pendingOrders}
            lockedOrders={lockedOrders}
            onAction={(id) => updateStatus(id, "preparing")}
            actionLabel="開始備餐"
            actionIcon={<ChefHat className="h-4 w-4" />}
          />

          {/* 準備中 */}
          <KanbanColumn
            title="準備中"
            count={preparingOrders.length}
            accentColor="blue"
            orders={preparingOrders}
            lockedOrders={lockedOrders}
            onAction={(id) => updateStatus(id, "ready")}
            actionLabel="完成出餐"
            actionIcon={<Bell className="h-4 w-4" />}
          />

          {/* 完成 */}
          <KanbanColumn
            title="完成"
            count={readyOrders.length}
            accentColor="green"
            orders={readyOrders}
            lockedOrders={lockedOrders}
            onAction={(id) => updateStatus(id, "completed")}
            actionLabel="已出餐"
            actionIcon={<CheckCircle className="h-4 w-4" />}
          />
        </div>

        {orders.length === 0 && !loading && (
          <div className="mt-16 text-center text-gray-400">
            <ChefHat className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>目前沒有進行中的訂單</p>
          </div>
        )}
      </div>
    </main>
  );
}

function KanbanColumn({
  title,
  count,
  accentColor,
  orders,
  lockedOrders,
  onAction,
  actionLabel,
  actionIcon,
}: {
  title: string;
  count: number;
  accentColor: "yellow" | "blue" | "green";
  orders: Order[];
  lockedOrders: Set<string>;
  onAction: (id: string) => void;
  actionLabel: string;
  actionIcon: React.ReactNode;
}) {
  const headerColor = {
    yellow: "bg-yellow-100 text-yellow-800 border-yellow-200",
    blue: "bg-blue-100 text-blue-800 border-blue-200",
    green: "bg-green-100 text-green-800 border-green-200",
  }[accentColor];

  const btnColor = {
    yellow: "bg-amber-600 hover:bg-amber-700",
    blue: "bg-blue-600 hover:bg-blue-700",
    green: "bg-green-600 hover:bg-green-700",
  }[accentColor];

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className={`flex items-center justify-between px-4 py-3 border-b ${headerColor}`}>
        <h2 className="font-semibold">{title}</h2>
        <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-bold">{count}</span>
      </div>
      <div className="p-3 space-y-3 min-h-40">
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            onAction={onAction}
            actionLabel={actionLabel}
            actionIcon={actionIcon}
            btnColor={btnColor}
            locked={lockedOrders.has(order.id)}
          />
        ))}
      </div>
    </div>
  );
}

function OrderCard({
  order,
  onAction,
  actionLabel,
  actionIcon,
  btnColor,
  locked,
}: {
  order: Order;
  onAction: (id: string) => void;
  actionLabel: string;
  actionIcon: React.ReactNode;
  btnColor: string;
  locked: boolean;
}) {
  const timeStr = format(parseISO(order.created_at), "HH:mm", { locale: zhTW });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="font-bold text-gray-900">
            {order.reservation_id ? "包廂訂位" : `桌 ${order.table?.number ?? "—"}`}
          </span>
        </div>
        <span className="text-xs text-gray-500">{timeStr}</span>
      </div>

      <ul className="text-sm text-gray-700 space-y-0.5 mb-2">
        {(order.order_items ?? []).map((item) => (
          <li key={item.id} className="flex items-start gap-1">
            <span className="font-medium text-gray-900 shrink-0">×{item.quantity}</span>
            <span>
              {item.item_name}
              {item.selected_options && item.selected_options.length > 0 && (
                <span className="text-gray-500 text-xs">
                  {" "}({item.selected_options.map((o) => o.name).join("／")})
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mb-2">
          備註：{order.notes}
        </p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900">
          ${order.total_amount}
        </span>
        {order.reservation_id ? <Link href={`/admin/reservation-orders/${order.reservation_id}`}
          className="inline-flex min-h-[44px] items-center rounded-lg bg-amber-700 px-4 text-sm font-medium text-white">查看餐點與出餐</Link> : <button
          type="button"
          disabled={locked}
          onClick={() => onAction(order.id)}
          className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-white disabled:opacity-50 ${btnColor}`}
        >
          {actionIcon}
          {actionLabel}
        </button>}
      </div>
    </div>
  );
}
