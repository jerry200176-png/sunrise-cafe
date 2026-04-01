"use client";

/**
 * 廚房列印站
 *
 * 使用方式：
 * 1. iPad 安裝「Star WebPRNT Browser」（App Store 免費）
 * 2. 在該 App 內開啟此頁面 URL
 * 3. 點「開始監聽」後保持畫面常亮，新訂單自動列印
 *
 * Star WebPRNT Browser 會在 localhost:22222 建立本機 HTTP 伺服器，
 * 此頁面透過 fetch 呼叫該端點，App 再轉送到 USB 連接的 TSP100III。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Branch, Order } from "@/types";
import { Printer, Wifi, WifiOff, Volume2 } from "lucide-react";

// Star WebPRNT Browser 預設 port
const STAR_PORT = 22222;
const STAR_URL = `http://localhost:${STAR_PORT}/StarWebPRNT/SendMessage`;

// 58mm 紙寬約 30 字（半形），中文字佔 2 格
const LINE = "==============================";
const THIN = "------------------------------";

function pad(str: string, width: number): string {
  const len = [...str].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
  return str + " ".repeat(Math.max(0, width - len));
}

function buildXml(order: Order): string {
  const shortId = order.id.slice(0, 8).toUpperCase();
  const tableNum = order.table?.number ?? "—";
  const now = new Date(order.created_at).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Taipei",
  });

  const lines: string[] = [
    LINE,
    "         廚房工單",
    LINE,
    `桌號：${tableNum}`,
    `時間：${now}  #${shortId}`,
    THIN,
  ];

  (order.order_items ?? []).forEach((item) => {
    lines.push(`x${item.quantity} ${item.item_name}`);
    if (item.selected_options && item.selected_options.length > 0) {
      lines.push(`   ${item.selected_options.map((o) => o.name).join(" / ")}`);
    }
    if (item.special_notes) {
      lines.push(`   >${item.special_notes}`);
    }
  });

  lines.push(THIN);
  if (order.notes) {
    lines.push(`備註：${order.notes}`);
    lines.push(THIN);
  }
  lines.push(`合計 $${order.total_amount}  (至櫃台結帳)`);
  lines.push(LINE);

  // 轉成 Star WebPRNT XML
  const textContent = lines
    .map((l) => l + "\n")
    .join("")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<?xml version="1.0" encoding="utf-8"?>
<root>
  <initialize/>
  <text>${textContent}</text>
  <feed line="4"/>
  <cut/>
</root>`;
}

async function sendToPrinter(xml: string): Promise<void> {
  const res = await fetch(STAR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml; charset=utf-8" },
    body: xml,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // Star WebPRNT 回傳 XML，判斷是否成功
  if (text.includes("CompletionStatus") && text.includes("Failure")) {
    throw new Error("印表機回報失敗，請確認紙張與連線");
  }
}

export default function PrintStationPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [listening, setListening] = useState(false);
  const [log, setLog] = useState<{ time: string; msg: string; ok: boolean }[]>([]);
  const [printerOk, setPrinterOk] = useState<boolean | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setBranches(list);
        if (list.length > 0) setBranchId(list[0].id);
      });
  }, []);

  const addLog = (msg: string, ok: boolean) => {
    const time = new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLog((prev) => [{ time, msg, ok }, ...prev].slice(0, 50));
  };

  const testPrinter = async () => {
    try {
      const testXml = `<?xml version="1.0" encoding="utf-8"?>
<root><initialize/><text>列印測試 OK\n</text><feed line="3"/><cut/></root>`;
      await sendToPrinter(testXml);
      setPrinterOk(true);
      addLog("印表機測試成功", true);
    } catch (err) {
      setPrinterOk(false);
      addLog(`印表機測試失敗：${err instanceof Error ? err.message : String(err)}`, false);
    }
  };

  const handleNewOrder = useCallback(async (orderId: string) => {
    try {
      const res = await fetch(`/api/admin/orders?branchId=${encodeURIComponent(branchId)}`);
      const data = await res.json();
      const order = (Array.isArray(data) ? data : []).find((o: Order) => o.id === orderId);
      if (!order) return;

      const xml = buildXml(order);
      await sendToPrinter(xml);

      // 標記已列印
      await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_printed: true }),
      });

      addLog(`桌 ${order.table?.number ?? "?"} 訂單列印成功`, true);
    } catch (err) {
      addLog(`列印失敗：${err instanceof Error ? err.message : String(err)}`, false);
    }
  }, [branchId]);

  const startListening = () => {
    if (!branchId) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    channelRef.current = supabase
      .channel(`print-station-${branchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `branch_id=eq.${branchId}` },
        async (payload) => {
          const orderId = payload.new?.id;
          if (!orderId) return;
          addLog(`收到新訂單 #${orderId.slice(0, 8).toUpperCase()}`, true);
          await handleNewOrder(orderId);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setListening(true);
          addLog("已連線，等待新訂單…", true);
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          setListening(false);
          addLog(`連線中斷（${status}）`, false);
        }
      });
  };

  const stopListening = () => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setListening(false);
    addLog("已停止監聽", false);
  };

  useEffect(() => {
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, []);

  return (
    <main className="min-h-screen bg-gray-900 text-white p-5">
      <div className="max-w-md mx-auto space-y-5">
        {/* 標題 */}
        <div className="flex items-center gap-3">
          <Printer className="h-7 w-7 text-amber-400" />
          <div>
            <h1 className="text-xl font-bold">廚房列印站</h1>
            <p className="text-xs text-gray-400">請在 Star WebPRNT Browser 內開啟此頁面</p>
          </div>
        </div>

        {/* 分店選擇 */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">分店</label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            disabled={listening}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {/* 印表機狀態 */}
        <div className="rounded-xl bg-gray-800 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full ${printerOk === true ? "bg-green-400" : printerOk === false ? "bg-red-400" : "bg-gray-600"}`} />
            <span className="text-sm">
              {printerOk === true ? "印表機已就緒" : printerOk === false ? "印表機連線失敗" : "尚未測試"}
            </span>
          </div>
          <button
            type="button"
            onClick={testPrinter}
            className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm hover:bg-gray-600"
          >
            測試列印
          </button>
        </div>

        {/* 監聽控制 */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={startListening}
            disabled={listening || !branchId}
            className="rounded-xl bg-amber-600 py-4 font-bold text-lg hover:bg-amber-700 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Wifi className="h-5 w-5" /> 開始監聽
          </button>
          <button
            type="button"
            onClick={stopListening}
            disabled={!listening}
            className="rounded-xl bg-gray-700 py-4 font-bold text-lg hover:bg-gray-600 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <WifiOff className="h-5 w-5" /> 停止
          </button>
        </div>

        {/* 狀態指示 */}
        {listening && (
          <div className="rounded-xl bg-green-900/50 border border-green-700 p-3 flex items-center gap-2">
            <Volume2 className="h-5 w-5 text-green-400 animate-pulse" />
            <span className="text-green-300 font-medium">正在監聽新訂單，請保持畫面常亮</span>
          </div>
        )}

        {/* 日誌 */}
        {log.length > 0 && (
          <div className="rounded-xl bg-gray-800 p-3 space-y-1 max-h-64 overflow-y-auto">
            {log.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 text-xs font-mono">
                <span className="text-gray-500 shrink-0">{entry.time}</span>
                <span className={entry.ok ? "text-green-400" : "text-red-400"}>{entry.msg}</span>
              </div>
            ))}
          </div>
        )}

        {/* 使用說明 */}
        <div className="rounded-xl bg-gray-800 p-4 text-xs text-gray-400 space-y-1.5">
          <p className="font-medium text-gray-300">使用步驟</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>iPad 安裝 <strong className="text-white">Star WebPRNT Browser</strong>（App Store 免費）</li>
            <li>確認 Star TSP100III 已透過 USB 連接 iPad</li>
            <li>在 Star WebPRNT Browser 內開啟此頁面</li>
            <li>按「測試列印」確認印表機正常</li>
            <li>按「開始監聽」，之後保持此頁面常亮</li>
          </ol>
        </div>
      </div>
    </main>
  );
}
