"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, CheckCircle, ChefHat, Bell, LogOut } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { supabase } from "@/lib/supabase";
import { responseError, thrownMessage } from "@/lib/friendly-error";
import type { Branch, Order, OrderStatus } from "@/types";

const ACTIVE_STATUSES: OrderStatus[] = ["pending", "preparing", "ready"];

export default function AdminOrdersPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevOrderIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setBranches(list);
        if (list.length > 0) setBranchId(list[0].id);
      });
  }, []);

  const loadOrders = async (bid: string) => {
    if (!bid) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/orders?branchId=${encodeURIComponent(bid)}`);
      if (!res.ok) {
        // 失敗時保留畫面上原本的單，並明說「沒更新」，不要假裝沒有訂單
        setLoadError(await responseError(res));
        return;
      }
      const data = await res.json();
      const active = (Array.isArray(data) ? data : []).filter((o: Order) =>
        ACTIVE_STATUSES.includes(o.status)
      );
      setOrders(active);
      setLoadError(null);
      setLastUpdated(
        new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Taipei" })
      );
    } catch (err) {
      setLoadError(thrownMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!branchId) return;
    loadOrders(branchId);
    const timer = window.setInterval(() => loadOrders(branchId), 15000);
    return () => window.clearInterval(timer);
  }, [branchId]);

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
  }, [branchId]);

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
    try {
      const res = await fetch(`/api/admin/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setActionError(`訂單沒有更新：${await responseError(res)}`);
        return;
      }
    } catch (err) {
      setActionError(`訂單沒有更新：${thrownMessage(err)}`);
      return;
    }
    setActionError(null);
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status } : o)).filter((o) =>
        ACTIVE_STATUSES.includes(o.status)
      )
    );
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
              onChange={(e) => setBranchId(e.target.value)}
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

      <div className="mx-auto max-w-7xl px-4 py-4">
        {/* 看板三欄 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 待處理 */}
          <KanbanColumn
            title="待處理"
            count={pendingOrders.length}
            accentColor="yellow"
            orders={pendingOrders}
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
  onAction,
  actionLabel,
  actionIcon,
}: {
  title: string;
  count: number;
  accentColor: "yellow" | "blue" | "green";
  orders: Order[];
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
}: {
  order: Order;
  onAction: (id: string) => void;
  actionLabel: string;
  actionIcon: React.ReactNode;
  btnColor: string;
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
          onClick={() => onAction(order.id)}
          className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 text-sm font-medium text-white ${btnColor}`}
        >
          {actionIcon}
          {actionLabel}
        </button>}
      </div>
    </div>
  );
}
