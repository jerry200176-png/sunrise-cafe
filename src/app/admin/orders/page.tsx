"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, CheckCircle, ChefHat, Bell, LogOut } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import { supabase } from "@/lib/supabase";
import type { Branch, Order, OrderStatus } from "@/types";

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "待處理",
  preparing: "準備中",
  ready: "完成",
  completed: "已結帳",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  pending: "bg-yellow-50 border-yellow-300",
  preparing: "bg-blue-50 border-blue-300",
  ready: "bg-green-50 border-green-300",
  completed: "bg-gray-50 border-gray-200",
  cancelled: "bg-red-50 border-red-200",
};

const STATUS_BADGE: Record<OrderStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  preparing: "bg-blue-100 text-blue-800",
  ready: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-700",
};

const ACTIVE_STATUSES: OrderStatus[] = ["pending", "preparing", "ready"];

export default function AdminOrdersPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
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
      const data = await res.json();
      const active = (Array.isArray(data) ? data : []).filter((o: Order) =>
        ACTIVE_STATUSES.includes(o.status)
      );
      setOrders(active);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!branchId) return;
    loadOrders(branchId);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // 偵測新訂單 → 播放音效
  useEffect(() => {
    const currentIds = new Set(orders.map((o) => o.id));
    const isNewOrder = orders.some((o) => !prevOrderIds.current.has(o.id));
    if (isNewOrder && prevOrderIds.current.size > 0) {
      audioRef.current?.play().catch(() => {});
    }
    prevOrderIds.current = currentIds;
  }, [orders]);

  const updateStatus = async (id: string, status: OrderStatus) => {
    await fetch(`/api/admin/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
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
      {/* 音效（使用 Web Audio API 合成嗶聲） */}
      <audio ref={audioRef} preload="none" />

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
              onClick={() => loadOrders(branchId)}
              className="rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50"
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
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

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
            actionLabel="結帳完成"
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
  const shortId = order.id.slice(0, 8).toUpperCase();
  const timeStr = format(parseISO(order.created_at), "HH:mm", { locale: zhTW });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="font-bold text-gray-900">
            桌 {order.table?.number ?? "—"}
          </span>
          <span className="ml-2 text-xs text-gray-400">#{shortId}</span>
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
        <button
          type="button"
          onClick={() => onAction(order.id)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white ${btnColor}`}
        >
          {actionIcon}
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
