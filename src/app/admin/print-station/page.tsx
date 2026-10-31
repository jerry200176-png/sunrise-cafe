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
import type { Order } from "@/types";
import { pickUnprinted, reconnectDelayMs } from "@/lib/print-queue";
import { thrownMessage } from "@/lib/friendly-error";
import { useAdminBranches } from "@/lib/use-admin-branches";
import { fetchAllAdminOrders, fetchPendingPrintStatus } from "@/lib/admin-orders-fetch";
import { Printer, Wifi, WifiOff, Volume2 } from "lucide-react";

// Star WebPRNT Browser 預設 port
const STAR_PORT = 22222;
const STAR_URL = `http://localhost:${STAR_PORT}/StarWebPRNT/SendMessage`;
const PENDING_PRINT_IDS_KEY = "sunrise.print.pending-ids";

type PendingPrint = { id: string; branchId: string };

function readPendingPrints(): { prints: Map<string, PendingPrint>; error: string | null } {
  try {
    const raw = window.localStorage.getItem(PENDING_PRINT_IDS_KEY);
    if (raw === null) return { prints: new Map(), error: null };
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) throw new Error("invalid pending print list");
    const prints = new Map<string, PendingPrint>();
    for (const value of values) {
      if (typeof value === "string") prints.set(value, { id: value, branchId: "" });
      else if (typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" && "branchId" in value && typeof value.branchId === "string") {
        prints.set(value.id, { id: value.id, branchId: value.branchId });
      } else throw new Error("invalid pending print entry");
    }
    return { prints, error: null };
  } catch {
    return { prints: new Map(), error: "無法讀取列印待確認記錄，為避免重複出單已鎖定列印。請勿清除瀏覽器資料，並聯絡管理者處理。" };
  }
}

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
  const { branches, loading: branchesLoading, error: branchesError, retry: retryBranches } = useAdminBranches();
  const [branchId, setBranchId] = useState("");
  const [wantListening, setWantListening] = useState(false);
  const [link, setLink] = useState<Link>("idle");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [log, setLog] = useState<{ time: string; msg: string; ok: boolean }[]>([]);
  const [printerOk, setPrinterOk] = useState<boolean | null>(null);
  const [sweepingNow, setSweepingNow] = useState(false);
  const [pendingPrintCount, setPendingPrintCount] = useState(0);
  const [pendingPrintDetails, setPendingPrintDetails] = useState<PendingPrint[]>([]);
  const [pendingPrintStorageError, setPendingPrintStorageError] = useState<string | null>(null);
  const [pendingPrintStorageReady, setPendingPrintStorageReady] = useState(false);
  const [checkingPending, setCheckingPending] = useState(false);
  const checkingPendingRef = useRef(false);
  const [resolvingPendingId, setResolvingPendingId] = useState<string | null>(null);
  const resolvingPendingRef = useRef(false);
  const [printerPostInFlight, setPrinterPostInFlight] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const attempt = useRef(0);
  const printedIds = useRef<Set<string>>(new Set());
  const pendingPrintIds = useRef<Map<string, PendingPrint>>(new Map());
  const printerPostInFlightRef = useRef<Set<string>>(new Set());
  const pendingPrintStorageBlocked = useRef(true);
  const sweeping = useRef(false);
  const sweepRunSequence = useRef(0);
  const activeSweepRun = useRef<number | null>(null);
  const selectedBranchRef = useRef(branchId);
  const sessionEpoch = useRef(0);
  const delayedSweeps = useRef<Set<number>>(new Set());
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  selectedBranchRef.current = branchId;

  const clearDelayedSweeps = useCallback(() => {
    for (const timer of delayedSweeps.current) window.clearTimeout(timer);
    delayedSweeps.current.clear();
  }, []);

  const isCurrentSession = useCallback((branch: string, epoch: number) =>
    selectedBranchRef.current === branch && sessionEpoch.current === epoch, []);

  const persistPendingPrintIds = useCallback(() => {
    try {
      if (pendingPrintIds.current.size > 0) {
        window.localStorage.setItem(PENDING_PRINT_IDS_KEY, JSON.stringify([...pendingPrintIds.current.values()]));
      } else {
        window.localStorage.removeItem(PENDING_PRINT_IDS_KEY);
      }
      pendingPrintStorageBlocked.current = false;
      setPendingPrintStorageError(null);
      return true;
    } catch {
      pendingPrintStorageBlocked.current = true;
      setPendingPrintStorageError("無法保存列印待確認記錄，為避免重複出單已鎖定列印。請檢查瀏覽器儲存空間並聯絡管理者。");
      return false;
    }
  }, []);

  const addPendingPrintId = useCallback((id: string, branchId: string) => {
    pendingPrintIds.current.set(id, { id, branchId });
    setPendingPrintCount(pendingPrintIds.current.size);
    setPendingPrintDetails([...pendingPrintIds.current.values()]);
    return persistPendingPrintIds();
  }, [persistPendingPrintIds]);

  const clearPendingPrintId = useCallback((id: string) => {
    const pending = pendingPrintIds.current.get(id);
    if (!pending) return true;
    pendingPrintIds.current.delete(id);
    if (!persistPendingPrintIds()) {
      pendingPrintIds.current.set(id, pending);
      setPendingPrintCount(pendingPrintIds.current.size);
      setPendingPrintDetails([...pendingPrintIds.current.values()]);
      return false;
    }
    setPendingPrintCount(pendingPrintIds.current.size);
    setPendingPrintDetails([...pendingPrintIds.current.values()]);
    return true;
  }, [persistPendingPrintIds]);

  const reconcilePendingPrintIds = useCallback((orders: Order[]) => {
    const cleared: PendingPrint[] = [];
    for (const order of orders) {
      const pending = pendingPrintIds.current.get(order.id);
      if (order.is_printed && pending && !printerPostInFlightRef.current.has(order.id)) {
        pendingPrintIds.current.delete(order.id);
        cleared.push(pending);
      }
    }
    if (cleared.length && !persistPendingPrintIds()) {
      for (const pending of cleared) pendingPrintIds.current.set(pending.id, pending);
    }
    setPendingPrintCount(pendingPrintIds.current.size);
    setPendingPrintDetails([...pendingPrintIds.current.values()]);
  }, [persistPendingPrintIds]);

  const invalidateSession = useCallback((unlockSweep = false) => {
    sessionEpoch.current++;
    clearDelayedSweeps();
    if (unlockSweep && activeSweepRun.current !== null) {
      activeSweepRun.current = null;
      sweeping.current = false;
      setSweepingNow(false);
    }
    if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
    if (channelRef.current) {
      const channel = channelRef.current;
      channelRef.current = null;
      supabase.removeChannel(channel);
    }
  }, [clearDelayedSweeps]);

  const pauseForManualReview = useCallback(() => {
    invalidateSession(true);
    setWantListening(false);
    setLink("idle");
  }, [invalidateSession]);

  useEffect(() => {
    if (branches.length && !branchId) setBranchId(branches[0].id);
  }, [branches, branchId]);

  useEffect(() => {
    const result = readPendingPrints();
    pendingPrintIds.current = result.prints;
    pendingPrintStorageBlocked.current = Boolean(result.error);
    setPendingPrintStorageError(result.error);
    setPendingPrintStorageReady(true);
    setPendingPrintCount(result.prints.size);
    setPendingPrintDetails([...result.prints.values()]);
  }, []);

  useEffect(() => {
    if (branchesLoading || branchesError) {
      if (wantListening) {
        invalidateSession(true);
        setWantListening(false);
        setLink("idle");
      }
      return;
    }
    if (!branchId || branches.some((branch) => branch.id === branchId)) return;
    invalidateSession(true);
    setWantListening(false);
    setLink("idle");
    setPrinterOk(null);
    const nextBranch = branches[0]?.id ?? "";
    selectedBranchRef.current = nextBranch;
    setBranchId(nextBranch);
  }, [branches, branchesLoading, branchesError, branchId, wantListening, invalidateSession]);

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
  const sweep = useCallback(async (requestedBranch: string, epoch: number) => {
    if (!requestedBranch || !isCurrentSession(requestedBranch, epoch) || sweeping.current || pendingPrintStorageBlocked.current || pendingPrintIds.current.size > 0) return;
    const run = ++sweepRunSequence.current;
    activeSweepRun.current = run;
    sweeping.current = true;
    setSweepingNow(true);
    try {
      const data = await fetchAllAdminOrders(requestedBranch, () => isCurrentSession(requestedBranch, epoch), "printable");
      if (!isCurrentSession(requestedBranch, epoch)) return;
      setSessionExpired(false);
      const orders = data;
      reconcilePendingPrintIds(orders);
      const excludedIds = new Set([...printedIds.current, ...pendingPrintIds.current.keys()]);
      for (const order of pickUnprinted(orders, excludedIds)) {
        if (!isCurrentSession(requestedBranch, epoch)) return;
        if (!addPendingPrintId(order.id, requestedBranch)) {
          addLog("無法保存列印待確認狀態，為避免重複出單已停止列印。請檢查瀏覽器儲存空間。", false);
          break;
        }
        printerPostInFlightRef.current.add(order.id);
        setPrinterPostInFlight(new Set(printerPostInFlightRef.current));
        try {
          await sendToPrinter(buildXml(order));
          printedIds.current.add(order.id);
          setPrinterOk(true);
          addLog(order.table?.number ? `桌 ${order.table.number} 訂單列印成功` : "訂位餐點列印成功", true);
        } catch (err) {
          setPrinterOk(false);
          addLog(`列印結果未確認：${thrownMessage(err, "印表機沒回應")}。已暫停自動重印，請先確認實體紙單。`, false);
          break; // 印表機有問題，不要連續轟炸；下一輪再試
        } finally {
          printerPostInFlightRef.current.delete(order.id);
          setPrinterPostInFlight(new Set(printerPostInFlightRef.current));
        }
        // A successful printer response is not enough to permit another copy after reload;
        // keep the persistent hold until the server confirms the printed flag.
        try {
          const mark = await fetch(`/api/admin/orders/${order.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_printed: true }),
          });
          if (mark.ok) {
            if (!clearPendingPrintId(order.id)) addLog("已列印，但待確認記錄無法清除；列印已鎖定，請聯絡管理者。", false);
          } else {
            addLog("已列印，但系統未確認列印標記。已暫停重印，請先確認訂單狀態。", false);
            break;
          }
        } catch {
          addLog("已列印，但系統未確認列印標記。已暫停重印，請先確認訂單狀態。", false);
          break;
        }
      }
    } catch (err) {
      if (isCurrentSession(requestedBranch, epoch)) {
        if (err instanceof Error && "status" in err && err.status === 401) setSessionExpired(true);
        else addLog("讀取訂單失敗，稍後會再試", false);
      }
    } finally {
      if (activeSweepRun.current === run) {
        activeSweepRun.current = null;
        sweeping.current = false;
        setSweepingNow(false);
      }
    }
  }, [addPendingPrintId, clearPendingPrintId, isCurrentSession, reconcilePendingPrintIds]);

  const checkPendingPrints = async () => {
    if (!branchId || branchesLoading || branchesError || !branches.some((branch) => branch.id === branchId) || pendingPrintStorageBlocked.current || checkingPendingRef.current || resolvingPendingRef.current) return;
    checkingPendingRef.current = true;
    pauseForManualReview();
    setCheckingPending(true);
    try {
      const requestedBranch = branchId;
      const epoch = sessionEpoch.current;
      const pending = [...pendingPrintIds.current.values()].filter((entry) => !entry.branchId || entry.branchId === requestedBranch);
      const data: Order[] = [];
      let unconfirmed = 0;
      for (const entry of pending) {
        if (!isCurrentSession(requestedBranch, epoch)) return;
        try {
          data.push(await fetchPendingPrintStatus(requestedBranch, entry.id));
        } catch {
          unconfirmed++;
        }
      }
      if (!isCurrentSession(requestedBranch, epoch)) return;
      const before = pendingPrintIds.current.size;
      reconcilePendingPrintIds(data as Order[]);
      if (unconfirmed > 0) {
        addLog(`已核對 ${data.length} 筆；另有 ${unconfirmed} 筆無法確認或不屬於本店，仍保持鎖定，請人工核對。列印站保持停止。`, false);
      } else {
        addLog(pendingPrintIds.current.size < before
          ? "已確認部分訂單已在後台標記列印完成。列印站保持停止。"
          : "已檢查目前分店；待確認單仍未標記完成，沒有送印或更新訂單。", true);
      }
    } catch (err) {
      addLog(`檢查待確認列印失敗：${thrownMessage(err, "請稍後重試")}`, false);
    } finally {
      checkingPendingRef.current = false;
      setCheckingPending(false);
    }
  };

  const resolvePendingPrint = async (pending: PendingPrint, resolution: "printed" | "allow-reprint") => {
    if (checkingPendingRef.current || resolvingPendingRef.current) return;
    if (printerPostInFlightRef.current.has(pending.id)) {
      addLog(`訂單 ${pending.id} 的印表機請求仍未完成，不能解除待確認鎖定。請保持列印站停止並等待結果。`, false);
      return;
    }
    const confirmed = resolution === "printed"
      ? window.confirm(`請先現場核對實體紙單與後台訂單。原列印請求可能延遲出紙；若頁面曾重載，請視為請求狀態未知。只有確認紙單確實已出才標記訂單 ${pending.id} 為已列印。`)
      : window.confirm(`請先現場核對實體紙單與後台訂單。原列印請求可能仍會稍後出紙，尤其頁面重載後狀態未知；解除鎖定後再次啟動可能重印。確認已核對無紙單並允許之後重新列印訂單 ${pending.id}？此操作現在不會送印。`);
    if (!confirmed) return;
    resolvingPendingRef.current = true;
    pauseForManualReview();
    setResolvingPendingId(pending.id);
    try {
      if (resolution === "printed") {
        const res = await fetch(`/api/admin/orders/${pending.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_printed: true }),
        });
        if (!res.ok) throw new Error(await res.text().catch(() => "訂單列印標記更新失敗"));
        printedIds.current.add(pending.id);
        if (!clearPendingPrintId(pending.id)) {
          addLog("訂單已手動標記列印，但本機待確認記錄仍鎖定；請聯絡管理者。", false);
          return;
        }
        addLog(`已依人工確認將訂單 ${pending.id} 標記為已列印；列印站保持停止。`, true);
      } else {
        printedIds.current.delete(pending.id);
        if (!clearPendingPrintId(pending.id)) {
          addLog("無法清除本機待確認記錄，列印仍保持鎖定。", false);
          return;
        }
        addLog(`已解除訂單 ${pending.id} 的列印鎖定；沒有送印。請再次核對後再手動啟動列印站。`, true);
      }
    } catch (err) {
      addLog(`待確認訂單處理失敗，列印仍保持鎖定：${thrownMessage(err, "請聯絡管理者")}`, false);
    } finally {
      resolvingPendingRef.current = false;
      setResolvingPendingId(null);
    }
  };

  const recoverPendingStorage = () => {
    if (printerPostInFlightRef.current.size > 0) {
      addLog("仍有印表機請求未完成，不能清除待確認記錄。請保持停止並等待結果。", false);
      return;
    }
    const confirmed = window.confirm("待確認清單無法讀取，涉及分店與訂單範圍未知。請逐店核對列印站上次正常運作後的所有實體紙單與後台列印狀態；原請求可能仍會稍後出紙，清除紀錄後可能重印。只有完成全部核對才繼續。此操作只清除本機鎖定，不會送印或修改訂單。確定已完成核對？");
    if (!confirmed) return;
    pauseForManualReview();
    try {
      const probe = `${PENDING_PRINT_IDS_KEY}.probe`;
      window.localStorage.setItem(probe, "ok");
      if (window.localStorage.getItem(probe) !== "ok") throw new Error("local storage write verification failed");
      window.localStorage.removeItem(probe);
      window.localStorage.removeItem(PENDING_PRINT_IDS_KEY);
      if (window.localStorage.getItem(PENDING_PRINT_IDS_KEY) !== null) throw new Error("pending record could not be removed");
      pendingPrintIds.current.clear();
      setPendingPrintCount(0);
      setPendingPrintDetails([]);
      pendingPrintStorageBlocked.current = false;
      setPendingPrintStorageError(null);
      setPendingPrintStorageReady(true);
      addLog("已依人工核對清除本機待確認記錄；沒有送印或修改訂單。列印站保持停止。", true);
    } catch {
      pendingPrintStorageBlocked.current = true;
      setPendingPrintStorageError("儲存空間仍無法讀寫，列印維持鎖定。請聯絡管理者；沒有送印或修改訂單。");
    }
  };

  const connect = useCallback((epoch: number) => {
    const branch = branchId;
    if (!branch || !isCurrentSession(branch, epoch)) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const channel = supabase
      .channel(`print-station-${branch}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `branch_id=eq.${branch}` },
        () => {
          if (!isCurrentSession(branch, epoch)) return;
          addLog("收到新訂單", true);
          // 訂單先寫入、餐點明細稍後才寫入：分幾次掃，等明細到齊才印，不會印出空單
          [300, 2000, 5000].forEach((ms) => {
            const timer = window.setTimeout(() => {
              delayedSweeps.current.delete(timer);
              void sweep(branch, epoch);
            }, ms);
            delayedSweeps.current.add(timer);
          });
        }
      )
      .subscribe((status) => {
        // 我們自己移除舊連線、或按了「停止」時也會收到 CLOSED，不能當成斷線去重連
        if (channelRef.current !== channel || !isCurrentSession(branch, epoch)) return;
        if (status === "SUBSCRIBED") {
          attempt.current = 0;
          setLink("connected");
          addLog("已連線，等待新訂單…", true);
          void sweep(branch, epoch); // 連上時先補印漏掉的單
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setLink("reconnecting");
          addLog("與系統連線中斷，正在重新連線…", false);
          if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
          reconnectTimer.current = window.setTimeout(() => connect(epoch), reconnectDelayMs(attempt.current++));
        }
      });
    channelRef.current = channel;
  }, [branchId, isCurrentSession, sweep]);

  const startListening = () => {
    if (!pendingPrintStorageReady || pendingPrintStorageBlocked.current || pendingPrintIds.current.size > 0) {
      addLog("仍有列印結果待確認，或待確認記錄無法讀取。請先檢查待確認訂單，不會自動重印。", false);
      return;
    }
    if (!branchId || branchesLoading || branchesError || !branches.some((branch) => branch.id === branchId)) {
      addLog("目前分店不在最新可管理清單中，請重新載入分店後再開始。", false);
      return;
    }
    clearDelayedSweeps();
    const epoch = ++sessionEpoch.current;
    setWantListening(true);
    attempt.current = 0;
    connect(epoch);
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    wl?.request("screen").then((l) => { wake.current = l; }).catch(() => {});
  };

  const stopListening = () => {
    invalidateSession(true);
    setWantListening(false);
    void wake.current?.release().catch(() => {});
    wake.current = null;
    setLink("idle");
    addLog("已停止監聽", true);
  };

  // 監聽中每 15 秒掃一次：即時通知漏了、或印表機剛恢復時都會補上
  useEffect(() => {
    if (!wantListening) return;
    const branch = branchId;
    const epoch = sessionEpoch.current;
    const timer = window.setInterval(() => void sweep(branch, epoch), 15000);
    return () => window.clearInterval(timer);
  }, [wantListening, branchId, sweep]);

  useEffect(() => {
    return () => invalidateSession();
  }, [invalidateSession]);

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
            onChange={(e) => {
              const nextBranch = e.target.value;
              if (selectedBranchRef.current !== nextBranch) {
                sessionEpoch.current++;
                clearDelayedSweeps();
                selectedBranchRef.current = nextBranch;
                setBranchId(nextBranch);
              }
              setPrinterOk(null);
            }}
            disabled={listening || sweepingNow || branchesLoading || Boolean(branchesError) || branches.length === 0}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        {pendingPrintStorageError && <div role="alert" className="rounded-xl border border-red-700 bg-red-950 p-3 text-sm text-red-100">
          <p>{pendingPrintStorageError}</p>
          <button type="button" onClick={recoverPendingStorage} disabled={printerPostInFlight.size > 0} className="mt-2 min-h-10 rounded-lg border border-red-400 px-3 disabled:opacity-50">完成全店人工核對後解除鎖定</button>
        </div>}
        {pendingPrintCount > 0 && <div role="alert" className="rounded-xl border border-amber-700 bg-amber-950 p-3 text-sm text-amber-100">
          <p>有 {pendingPrintCount} 張訂單列印結果待確認。為避免兩店工單混印，列印站已鎖定且不會自動重送。</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {pendingPrintDetails.map((pending) => {
              const branchName = branches.find((branch) => branch.id === pending.branchId)?.name ?? (pending.branchId ? `分店 ${pending.branchId}` : "分店未記錄");
              const requestInFlight = printerPostInFlight.has(pending.id);
              return <li key={pending.id} className="space-y-2">
                <p>{branchName} · 訂單 ID：{pending.id}</p>
                {requestInFlight && <p className="text-amber-200">此訂單的印表機請求仍未完成；暫不可標記或解除待確認。</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void resolvePendingPrint(pending, "printed")} disabled={checkingPending || resolvingPendingId !== null || requestInFlight} className="min-h-10 rounded-lg border border-amber-500 px-3 disabled:opacity-50">我已核對紙單已出，手動標記已列印</button>
                  <button type="button" onClick={() => void resolvePendingPrint(pending, "allow-reprint")} disabled={checkingPending || resolvingPendingId !== null || requestInFlight} className="min-h-10 rounded-lg border border-amber-500 px-3 disabled:opacity-50">我已核對無紙單，解除鎖定</button>
                </div>
              </li>;
            })}
          </ul>
          <p className="mt-2">請選取對應分店並檢查實體紙單與後台列印標記。只會檢查狀態，不會送印；若仍無法確認，請保持列印站停止並聯絡管理者處理。</p>
          <button type="button" onClick={() => void checkPendingPrints()} disabled={checkingPending || resolvingPendingId !== null || branchesLoading || Boolean(branchesError) || !branches.some((branch) => branch.id === branchId)} className="mt-2 min-h-10 rounded-lg border border-amber-500 px-3 disabled:opacity-50">
            {checkingPending ? "檢查中…" : "只檢查目前分店的列印標記"}
          </button>
        </div>}
        {branchesError && <p role="alert" className="rounded-xl border border-red-800 bg-red-950 p-3 text-sm text-red-200">
          無法載入分店：{branchesError} <button type="button" className="ml-2 underline" onClick={() => void retryBranches()}>重試</button>
        </p>}
        {!branchesLoading && !branchesError && branches.length === 0 && <p role="status" className="rounded-xl border border-gray-700 bg-gray-800 p-3 text-sm text-gray-300">目前沒有可管理的分店。</p>}

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
            disabled={listening || !branchId || branchesLoading || Boolean(branchesError) || !branches.some((branch) => branch.id === branchId) || !pendingPrintStorageReady || pendingPrintStorageBlocked.current || pendingPrintCount > 0}
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
