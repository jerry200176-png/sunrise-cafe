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
import { pickUnprinted, reconnectDelayMs } from "@/lib/print-queue";
import { thrownMessage } from "@/lib/friendly-error";
import { Printer, Wifi, WifiOff, Volume2 } from "lucide-react";

// Star WebPRNT Browser 預設 port
const STAR_PORT = 22222;
const STAR_URL = `http://localhost:${STAR_PORT}/StarWebPRNT/SendMessage`;

// 58mm 紙寬約 30 字（半形），中文字佔 2 格
const LINE = "==============================";
const THIN = "------------------------------";

function buildXml(order: Order): string {
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
    `時間：${now}`,
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
  if (!res.ok) throw new Error("印表機沒回應，請確認 Star App 已開啟且印表機已連線");
  const text = await res.text();
  // Star WebPRNT 回傳 XML，判斷是否成功
  if (text.includes("CompletionStatus") && text.includes("Failure")) {
    throw new Error("印表機回報失敗，請確認紙張與連線");
  }
}

type Link = "idle" | "connected" | "reconnecting";

export default function PrintStationPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [wantListening, setWantListening] = useState(false);
  const [link, setLink] = useState<Link>("idle");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [log, setLog] = useState<{ time: string; msg: string; ok: boolean }[]>([]);
  const [printerOk, setPrinterOk] = useState<boolean | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const attempt = useRef(0);
  const printedIds = useRef<Set<string>>(new Set());
  const sweeping = useRef(false);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setBranches(list);
        if (list.length > 0) setBranchId(list[0].id);
      })
      .catch(() => {});
  }, []);

  const addLog = (msg: string, ok: boolean) => {
    const time = new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Taipei" });
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
      addLog(`印表機測試失敗：${thrownMessage(err, "印表機沒回應")}`, false);
    }
  };

  /** 補印所有「還沒印」的訂單。即時通知只是提醒它現在就掃一次；斷線期間漏掉的單也靠這裡補上。 */
  const sweep = useCallback(async () => {
    if (!branchId || sweeping.current) return;
    sweeping.current = true;
    try {
      const res = await fetch(`/api/admin/orders?branchId=${encodeURIComponent(branchId)}`);
      if (res.status === 401) {
        setSessionExpired(true);
        return;
      }
      if (!res.ok) {
        addLog("讀取訂單失敗，稍後會再試", false);
        return;
      }
      setSessionExpired(false);
      const data = await res.json().catch(() => null);
      for (const order of pickUnprinted(Array.isArray(data) ? data : [], printedIds.current)) {
        try {
          await sendToPrinter(buildXml(order));
          printedIds.current.add(order.id);
          setPrinterOk(true);
          addLog(order.table?.number ? `桌 ${order.table.number} 訂單列印成功` : "訂位餐點列印成功", true);
          const mark = await fetch(`/api/admin/orders/${order.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_printed: true }),
          });
          if (!mark.ok) addLog("已列印，但沒能記錄成已列印（本次不會重印）", false);
        } catch (err) {
          setPrinterOk(false);
          addLog(`列印失敗：${thrownMessage(err, "印表機沒回應")}，稍後會再試`, false);
          break; // 印表機有問題，不要連續轟炸；下一輪再試
        }
      }
    } catch {
      addLog("連不上系統，稍後會再試", false);
    } finally {
      sweeping.current = false;
    }
  }, [branchId]);

  const connect = useCallback(() => {
    if (!branchId) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const channel = supabase
      .channel(`print-station-${branchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `branch_id=eq.${branchId}` },
        () => {
          addLog("收到新訂單", true);
          // 訂單先寫入、餐點明細稍後才寫入：分幾次掃，等明細到齊才印，不會印出空單
          [300, 2000, 5000].forEach((ms) => window.setTimeout(() => void sweep(), ms));
        }
      )
      .subscribe((status) => {
        // 我們自己移除舊連線、或按了「停止」時也會收到 CLOSED，不能當成斷線去重連
        if (channelRef.current !== channel) return;
        if (status === "SUBSCRIBED") {
          attempt.current = 0;
          setLink("connected");
          addLog("已連線，等待新訂單…", true);
          void sweep(); // 連上時先補印漏掉的單
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setLink("reconnecting");
          addLog("與系統連線中斷，正在重新連線…", false);
          if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
          reconnectTimer.current = window.setTimeout(connect, reconnectDelayMs(attempt.current++));
        }
      });
    channelRef.current = channel;
  }, [branchId, sweep]);

  const startListening = () => {
    if (!branchId) return;
    setWantListening(true);
    attempt.current = 0;
    connect();
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    wl?.request("screen").then((l) => { wake.current = l; }).catch(() => {});
  };

  const stopListening = () => {
    setWantListening(false);
    if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
    if (channelRef.current) {
      const ch = channelRef.current;
      channelRef.current = null;
      supabase.removeChannel(ch);
    }
    void wake.current?.release().catch(() => {});
    wake.current = null;
    setLink("idle");
    addLog("已停止監聽", true);
  };

  // 監聽中每 15 秒掃一次：即時通知漏了、或印表機剛恢復時都會補上
  useEffect(() => {
    if (!wantListening) return;
    const timer = window.setInterval(() => void sweep(), 15000);
    return () => window.clearInterval(timer);
  }, [wantListening, sweep]);

  useEffect(() => {
    return () => {
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, []);

  const listening = wantListening;
  const problem = sessionExpired
    ? "登入已過期，新訂單不會列印。請重新登入。"
    : printerOk === false
      ? "印表機沒回應，新訂單暫時印不出來。請確認 Star App 已開啟、印表機已連線。"
      : link === "reconnecting"
        ? "與系統連線中斷，正在重新連線…（恢復後會補印漏掉的單）"
        : null;

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
              {printerOk === true ? "印表機正常" : printerOk === false ? "印表機沒回應" : "尚未測試"}
            </span>
          </div>
          <button
            type="button"
            onClick={testPrinter}
            className="min-h-[44px] rounded-lg bg-gray-700 px-4 text-sm hover:bg-gray-600"
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

        {/* 狀態指示：只有真的正常才是綠色 */}
        {listening && (problem ? (
          <div role="alert" className="rounded-xl bg-red-900/60 border border-red-600 p-3 text-red-200 font-medium">
            {problem}
            {sessionExpired && (
              <a href="/admin/login" className="mt-2 block rounded-lg bg-red-700 py-2 text-center text-white">重新登入</a>
            )}
          </div>
        ) : link === "connected" ? (
          <div className="rounded-xl bg-green-900/50 border border-green-700 p-3 flex items-center gap-2">
            <Volume2 className="h-5 w-5 text-green-400 animate-pulse" />
            <span className="text-green-300 font-medium">正在監聽新訂單，請保持畫面常亮</span>
          </div>
        ) : (
          <div className="rounded-xl bg-gray-800 p-3 text-gray-300">連線中…</div>
        ))}

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
