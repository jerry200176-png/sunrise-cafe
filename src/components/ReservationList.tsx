"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { formatReservationDateKey, reservationDateKey, toTaipei } from "@/lib/datetime";
import { Calendar, Clock, DoorOpen, Pencil, Users, X, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isDepositRequired, isWeekendDate } from "@/lib/booking-utils";
import { buildPaymentMessage, type BranchPaymentConfig } from "@/lib/payment-message";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import type { Reservation, ReservationStatus, Room } from "@/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DepositStatusControl } from "@/components/admin/DepositStatusControl";
import { transferInfoLabel, type DepositInfo } from "@/components/admin/DepositPaidDialog";
import { BatchDepositMessageWorkbench } from "@/components/BatchDepositMessageWorkbench";
import { ToastStack, type ToastItem, type ToastVariant } from "@/components/Toast";
import {
  RESERVATION_MESSAGE_TEMPLATES,
  type ReservationMessageTemplateKey,
} from "@/lib/reservation-message";
import { preorderStatusLabel, reservationStatusLabel } from "@/lib/status-labels";
import type { BatchReservationMessageItem } from "@/lib/reservation-message-batch";
import { beginReservationMutation, clearReservationMutationUnknown, endReservationMutation, markReservationMutationUnknown, reservationMutationsServerSnapshot, reservationMutationsSnapshot, subscribeReservationMutations } from "@/lib/admin-reservation-mutation-lock";

function getPricePerHour(room: Room, dateStr: string): number {
  return isWeekendDate(dateStr) ? Number(room.price_weekend) : Number(room.price_weekday);
}

const RESERVATIONS_API = "/api/reservations";
/** 歷史紀錄每頁筆數（伺服器上限 200）。 */
const HISTORY_PAGE_SIZE = 50;
const HISTORY_REFRESH_MAX = 200;

type HistoryRange = "7d" | "30d" | "90d" | "all";
type HistoryStatus = "all" | "completed" | "cancelled" | "no_show" | "auto_cancelled";

const HISTORY_RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "90d", label: "近 90 天" },
  { value: "all", label: "全部" },
];

const HISTORY_STATUS_OPTIONS: { value: Exclude<HistoryStatus, "auto_cancelled">; label: string }[] = [
  { value: "all", label: "全部狀態" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
  { value: "no_show", label: "沒來" },
];

const TERMINAL_STATUSES = ["cancelled", "completed", "no_show"];

interface ReservationListResponse {
  items?: Reservation[];
  nextCursor?: string | null;
  total?: number | null;
  warnings?: string[];
  error?: string;
}

function isReservationRows(value: unknown): value is Reservation[] {
  return Array.isArray(value) && value.every((row) =>
    row !== null && typeof row === "object" &&
    typeof row.id === "string" && typeof row.room_id === "string" &&
    typeof row.customer_name === "string" && typeof row.phone === "string" &&
    typeof row.status === "string" && typeof row.start_time === "string" &&
    typeof row.end_time === "string" && Number.isFinite(Date.parse(row.start_time)) &&
    Number.isFinite(Date.parse(row.end_time))
  );
}

function responseObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** 依 id 合併（後面的覆蓋前面的），未結案與已載入的歷史紀錄共用同一份列表狀態。 */
function mergeById(...lists: Reservation[][]): Reservation[] {
  const map = new Map<string, Reservation>();
  for (const list of lists) for (const r of list) map.set(r.id, r);
  return [...map.values()];
}


const STATUS_OPTIONS: { value: ReservationStatus; label: string }[] = [
  { value: "pending", label: "待確認" },
  { value: "confirmed", label: "已確認" },
  { value: "checked_in", label: "已到店" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
  { value: "no_show", label: "沒來" },
];

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-green-100 text-green-800",
  checked_in: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-gray-100 text-gray-600",
  completed: "bg-blue-100 text-blue-800",
  no_show: "bg-rose-100 text-rose-800",
  paid: "bg-blue-100 text-blue-800",
};

const normalizeText = (value: string) =>
  value.toLowerCase().replace(/\s+/g, "");

const toTaiwanParts = (iso: string) => {
  const d = new Date(iso);
  const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return {
    date: tw.toISOString().slice(0, 10),
    time: `${String(tw.getUTCHours()).padStart(2, "0")}:${String(tw.getUTCMinutes()).padStart(2, "0")}`,
    ms: d.getTime(),
  };
};

interface ReservationListProps {
  branchId: string | null;
  rooms?: Room[];
  focusReservationId?: string | null;
}

export function ReservationList({ branchId, rooms = [], focusReservationId = null }: ReservationListProps) {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const pendingMutations = useSyncExternalStore(subscribeReservationMutations, reservationMutationsSnapshot, reservationMutationsServerSnapshot);
  const stalePendingMutations = useRef(new Set(reservationMutationsSnapshot().keys()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editDuration, setEditDuration] = useState(2);
  const [editTotalPrice, setEditTotalPrice] = useState<number | "">("");
  const [editGuestCount, setEditGuestCount] = useState<number | "">("");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState<ReservationStatus>("confirmed");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editStale, setEditStale] = useState(false);
  const editStaleRef = useRef(false);
  const editingRef = useRef<Reservation | null>(null);
  const realtimePendingRef = useRef(false);
  const realtimeVersion = useRef(0);
  const [realtimePending, setRealtimePending] = useState(false);
  const [activeTab, setActiveTab] = useState<"pending" | "upcoming" | "history">("pending");
  const [searchTerm, setSearchTerm] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("30d");
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("all");
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyTotal, setHistoryTotal] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [activeWarnings, setActiveWarnings] = useState<string[]>([]);
  const [historyWarnings, setHistoryWarnings] = useState<string[]>([]);
  const activeRowsRef = useRef<Reservation[]>([]);
  const historyRowsRef = useRef<Reservation[]>([]);
  const extraRowsRef = useRef<Reservation[]>([]);
  /** 目前已載入的歷史篩選條件（null = 尚未載入）；切換分頁回來不重抓。 */
  const historyKeyRef = useRef<string | null>(null);
  const historyRequest = useRef(0);
  const branchGeneration = useRef(0);
  const currentBranch = useRef(branchId);
  const activeRequest = useRef(0);
  const verificationRequired = useRef(false);
  const verificationInProgress = useRef(false);
  const verificationRequest = useRef(0);
  const [verificationPending, setVerificationPending] = useState(false);
  const batchRequest = useRef(0);
  const focusLookupRef = useRef<string | null>(null);
  const focusLookupRequest = useRef(0);
  const currentFocusId = useRef(focusReservationId);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"time_desc" | "time_asc" | "price_desc" | "price_asc">(
    "time_asc"
  );
  const [sendingLine, setSendingLine] = useState(false);
  const [branchConfig, setBranchConfig] = useState<BranchPaymentConfig | null>(null);
  const [branchConfigStatus, setBranchConfigStatus] = useState<"loading" | "ready" | "error">("loading");
  const [branchConfigRetry, setBranchConfigRetry] = useState(0);
  const [messageWorkbench, setMessageWorkbench] = useState<Reservation | null>(null);
  const [messageTemplate, setMessageTemplate] =
    useState<ReservationMessageTemplateKey>("booking_confirmation");
  const [messageText, setMessageText] = useState("");
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);
  const [messageSubmitting, setMessageSubmitting] = useState(false);
  const messagePreviewRequest = useRef(0);
  const openedFocusReservationId = useRef<string | null>(null);
  const [selectedReservationIds, setSelectedReservationIds] = useState<string[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchWorkbench, setBatchWorkbench] = useState<{
    reservationIds: string[];
    batchId: string;
    items: BatchReservationMessageItem[];
    combinedText: string;
    canBatchCopy: boolean;
    warnings: string[];
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string } | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const beginMutation = (id: string) => {
    if (!branchId || realtimePendingRef.current) return false;
    const code = reservations.find((reservation) => reservation.id === id)?.booking_code;
    return beginReservationMutation(id, branchId, code || `代碼末六碼 ${id.slice(-6)}`);
  };

  const loadMessagePreview = useCallback(
    async (reservationId: string, templateKey: ReservationMessageTemplateKey) => {
      const requestId = ++messagePreviewRequest.current;
      setMessageLoading(true);
      setMessageCopied(false);
      try {
        const response = await fetch(
          `${RESERVATIONS_API}/${reservationId}/message-actions?template_key=${encodeURIComponent(templateKey)}`
        );
        const data = (await response.json().catch(() => ({}))) as {
          text?: string;
          error?: string;
        };
        if (!response.ok || !data.text) {
          throw new Error(data.error ?? "無法產生訊息");
        }
        if (requestId === messagePreviewRequest.current) {
          setMessageText(data.text);
        }
      } catch (error) {
        if (requestId === messagePreviewRequest.current) {
          setMessageText("");
          showToast(error instanceof Error ? error.message : "無法產生訊息", "error");
        }
      } finally {
        if (requestId === messagePreviewRequest.current) {
          setMessageLoading(false);
        }
      }
    },
    [showToast]
  );

  const openMessageWorkbench = useCallback(
    (reservation: Reservation) => {
      if (realtimePendingRef.current || reservationMutationsSnapshot().has(reservation.id)) {
        showToast("此訂位正在處理，請稍候並重新確認資料。", "info");
        return;
      }
      setMessageWorkbench(reservation);
      setMessageTemplate("booking_confirmation");
      void loadMessagePreview(reservation.id, "booking_confirmation");
    },
    [loadMessagePreview, showToast]
  );

  const submitMessageAction = useCallback(
    async (action: "copied" | "manual_sent") => {
      if (!messageWorkbench) return false;
      const generation = branchGeneration.current;
      const previewId = messagePreviewRequest.current;
      const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation && messagePreviewRequest.current === previewId;
      if (!isCurrent()) return false;
      setMessageSubmitting(true);
      try {
        const response = await fetch(
          `${RESERVATIONS_API}/${messageWorkbench.id}/message-actions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              template_key: messageTemplate,
              channel: "manual_line",
              action,
            }),
          }
        );
        const data = (await response.json().catch(() => ({}))) as {
          text?: string;
          error?: string;
        };
        if (!isCurrent()) return false;
        if (!response.ok) throw new Error(data.error ?? "訊息操作失敗");
        if (data.text) setMessageText(data.text);
        return true;
      } catch (error) {
        if (isCurrent()) showToast(error instanceof Error ? error.message : "訊息操作失敗", "error");
        return false;
      } finally {
        if (isCurrent()) setMessageSubmitting(false);
      }
    },
    [branchId, messageTemplate, messageWorkbench, showToast]
  );

  const copyWorkbenchMessage = useCallback(async () => {
    if (!messageText || messageLoading) return;
    const generation = branchGeneration.current;
    const previewId = messagePreviewRequest.current;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(messageText);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = messageText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      if (branchGeneration.current !== generation || currentBranch.current !== branchId || messagePreviewRequest.current !== previewId) return;
      const recorded = await submitMessageAction("copied");
      if (recorded) {
        setMessageCopied(true);
        showToast("已複製訊息；請貼到客人的 LINE 對話", "success");
      }
    } catch {
      if (branchGeneration.current === generation && currentBranch.current === branchId && messagePreviewRequest.current === previewId) showToast("複製失敗，請手動選取訊息內容", "error");
    }
  }, [branchId, messageLoading, messageText, showToast, submitMessageAction]);

  const toggleReservationSelection = useCallback((reservationId: string) => {
    batchRequest.current += 1;
    setBatchLoading(false);
    setBatchWorkbench(null);
    setSelectedReservationIds((current) =>
      current.includes(reservationId)
        ? current.filter((id) => id !== reservationId)
        : [...current, reservationId]
    );
  }, []);

  const selectVisibleReservations = useCallback((ids: string[], checked: boolean) => {
    batchRequest.current += 1;
    setBatchLoading(false);
    setBatchWorkbench(null);
    setSelectedReservationIds((current) => {
      if (checked) return Array.from(new Set([...current, ...ids]));
      const visible = new Set(ids);
      return current.filter((id) => !visible.has(id));
    });
  }, []);

  useLayoutEffect(() => {
    if (!selectedReservationIds.some((id) => pendingMutations.has(id))) return;
    batchRequest.current += 1;
    setBatchLoading(false);
    setBatchWorkbench(null);
  }, [pendingMutations, selectedReservationIds]);

  useLayoutEffect(() => {
    if (!messageWorkbench || !pendingMutations.has(messageWorkbench.id)) return;
    messagePreviewRequest.current += 1;
    setMessageWorkbench(null);
    setMessageText("");
    setMessageCopied(false);
    setMessageLoading(false);
    setMessageSubmitting(false);
  }, [messageWorkbench, pendingMutations]);

  const openBatchDepositWorkbench = useCallback(async () => {
    if (currentBranch.current !== branchId) return;
    if (realtimePendingRef.current) { showToast("資料正在更新，請稍候並重新確認。", "info"); return; }
    const generation = branchGeneration.current;
    const requestId = ++batchRequest.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation && batchRequest.current === requestId;
    const reservationIds = [...selectedReservationIds];
    if (reservationIds.length === 0) {
      showToast("請先選取至少一筆訂位", "error");
      return;
    }
    if (reservationIds.some((id) => reservationMutationsSnapshot().has(id))) {
      showToast("選取的訂位仍在處理，請稍候並重新確認資料。", "info");
      return;
    }
    setBatchLoading(true);
    try {
      const response = await fetchWithTimeout("/api/reservations/message-actions/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_ids: reservationIds,
          template_key: "deposit_request",
          action: "preview",
        }),
      });
      const data = (await readJsonWithTimeout(response).catch(() => ({}))) as {
        batch_id?: string;
        items?: BatchReservationMessageItem[];
        combined_text?: string;
        can_batch_copy?: boolean;
        warnings?: string[];
        error?: string;
      };
      if (!isCurrent()) return;
      if (!response.ok || !data.batch_id || !data.items || !data.combined_text) {
        throw new Error(data.error ?? "無法產生批次訂金訊息");
      }
      setBatchWorkbench({
        reservationIds,
        batchId: data.batch_id,
        items: data.items,
        combinedText: data.combined_text,
        canBatchCopy: data.can_batch_copy === true,
        warnings: data.warnings ?? [],
      });
    } catch (error) {
      if (isCurrent()) showToast(error instanceof Error ? error.message : "無法產生批次訂金訊息", "error");
    } finally {
      if (isCurrent()) setBatchLoading(false);
    }
  }, [branchId, selectedReservationIds, showToast]);

  const openConfirm = useCallback((title: string, message: string) => {
    return new Promise<boolean>((resolve) => {
      confirmResolver.current = resolve;
      setConfirmDialog({ title, message });
    });
  }, []);

  const closeConfirm = useCallback((result: boolean) => {
    confirmResolver.current?.(result);
    confirmResolver.current = null;
    setConfirmDialog(null);
  }, []);

  const publishRows = useCallback(() => {
    setReservations(mergeById(extraRowsRef.current, activeRowsRef.current, historyRowsRef.current));
  }, []);

  useLayoutEffect(() => {
    const previousFocus = currentFocusId.current;
    if (previousFocus !== focusReservationId && openedFocusReservationId.current === previousFocus) {
      setEditing(null);
      editingRef.current = null;
      editStaleRef.current = false;
      setEditStale(false);
      setEditError(null);
      openedFocusReservationId.current = null;
    }
    currentFocusId.current = focusReservationId;
    focusLookupRequest.current += 1;
    focusLookupRef.current = null;
    extraRowsRef.current = [];
    publishRows();
  }, [focusReservationId, publishRows]);

  const loadFocusedReservation = useCallback(async (id: string): Promise<boolean> => {
    if (!branchId || currentBranch.current !== branchId || currentFocusId.current !== id) return false;
    const generation = branchGeneration.current;
    const requestId = ++focusLookupRequest.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation && currentFocusId.current === id && focusLookupRequest.current === requestId;
    focusLookupRef.current = id;
    try {
      const params = new URLSearchParams({ branchId, scope: "history", id });
      const response = await fetchWithTimeout(`${RESERVATIONS_API}?${params.toString()}`);
      const payload = responseObject(await readJsonWithTimeout(response).catch(() => null));
      if (!isCurrent()) return false;
      if (!response.ok || !payload || !isReservationRows(payload.items) || payload.items.length > 1 || (payload.items[0] && payload.items[0].id !== id)) {
        focusLookupRef.current = null;
        return false;
      }
      extraRowsRef.current = payload.items;
      publishRows();
      return true;
    } catch {
      if (isCurrent()) focusLookupRef.current = null;
      return false;
    }
  }, [branchId, publishRows]);

  const historyKey = `${branchId}|${historyRange}|${historyStatus}|${historySearch}`;
  // 篩選條件與游標放在 ref：fetchHistory 保持穩定，才不會連帶讓未結案列表與即時訂閱重跑
  const historyFiltersRef = useRef({ range: historyRange, status: historyStatus, q: historySearch, key: historyKey });
  historyFiltersRef.current = { range: historyRange, status: historyStatus, q: historySearch, key: historyKey };
  const historyCursorRef = useRef<string | null>(null);

  // Invalidate every request from the previous branch before its data can be
  // painted or an A → B → A navigation can make an old response current again.
  useLayoutEffect(() => {
    currentBranch.current = branchId;
    branchGeneration.current += 1;
    activeRequest.current += 1;
    verificationRequired.current = false;
    realtimeVersion.current += 1;
    realtimePendingRef.current = false;
    setRealtimePending(false);
    verificationInProgress.current = false;
    verificationRequest.current += 1;
    setVerificationPending(false);
    historyRequest.current += 1;
    focusLookupRequest.current += 1;
    focusLookupRef.current = null;
    batchRequest.current += 1;
    for (const id of reservationMutationsSnapshot().keys()) stalePendingMutations.current.add(id);
    messagePreviewRequest.current += 1;
    activeRowsRef.current = [];
    historyRowsRef.current = [];
    extraRowsRef.current = [];
    historyKeyRef.current = null;
    focusLookupRef.current = null;
    openedFocusReservationId.current = null;
    historyCursorRef.current = null;
    setReservations([]);
    setSelectedReservationIds([]);
    setBatchWorkbench(null);
    setBatchLoading(false);
    setEditing(null);
    editingRef.current = null;
    editStaleRef.current = false;
    setEditStale(false);
    setMessageWorkbench(null);
    setMessageText("");
    setMessageCopied(false);
    setMessageLoading(false);
    setMessageSubmitting(false);
    setBranchConfig(null);
    setBranchConfigStatus("loading");
    setEditSubmitting(false);
    setRestoringId(null);
    setSendingLine(false);
    confirmResolver.current?.(false);
    confirmResolver.current = null;
    setConfirmDialog(null);
    setLoading(Boolean(branchId));
    setError(null);
    setHistoryCursor(null);
    setHistoryTotal(null);
    setHistoryWarnings([]);
    setHistoryError(null);
    setHistoryLoading(false);
    setHistoryLoadingMore(false);
    setActiveWarnings([]);
    return () => { branchGeneration.current += 1; };
  }, [branchId]);

  /** 載入歷史紀錄：mode=replace 重抓第一頁（或目前已載入的筆數），append 為「載入更多」。 */
  const fetchHistory = useCallback(
    async (mode: "replace" | "append" | "refresh") => {
      if (!branchId || currentBranch.current !== branchId) return false;
      const requestId = ++historyRequest.current;
      const limit =
        mode === "refresh"
          ? Math.min(HISTORY_REFRESH_MAX, Math.max(HISTORY_PAGE_SIZE, historyRowsRef.current.length))
          : HISTORY_PAGE_SIZE;
      if (mode === "append") setHistoryLoadingMore(true);
      if (mode === "replace") {
        setHistoryLoading(true);
        historyRowsRef.current = [];
        publishRows();
      }
      setHistoryError(null);
      try {
        const filters = historyFiltersRef.current;
        const params = new URLSearchParams({
          branchId,
          scope: "history",
          range: filters.range,
          status: filters.status,
          limit: String(limit),
        });
        if (filters.q) params.set("q", filters.q);
        if (mode === "append" && historyCursorRef.current) params.set("cursor", historyCursorRef.current);
        const res = await fetchWithTimeout(`${RESERVATIONS_API}?${params.toString()}`);
        const data = (await readJsonWithTimeout(res).catch(() => ({}))) as ReservationListResponse;
        if (requestId !== historyRequest.current) return false;
        if (!res.ok) {
          setHistoryError(data.error ?? "無法載入歷史紀錄");
          return false;
        }
        if (!isReservationRows(data.items)) throw new Error("無法載入歷史紀錄，請重試");
        const items = data.items;
        historyRowsRef.current =
          mode === "append" ? mergeById(historyRowsRef.current, items) : items;
        historyKeyRef.current = filters.key;
        historyCursorRef.current = data.nextCursor ?? null;
        setHistoryCursor(data.nextCursor ?? null);
        if (mode !== "append") setHistoryTotal(data.total ?? null);
        setHistoryWarnings(data.warnings ?? []);
        publishRows();
        return true;
      } catch (e) {
        if (requestId === historyRequest.current) {
          setHistoryError(e instanceof Error ? e.message : "連線失敗");
        }
        return false;
      } finally {
        if (requestId === historyRequest.current) {
          setHistoryLoading(false);
          setHistoryLoadingMore(false);
        }
      }
    },
    [branchId, publishRows]
  );

  const fetchReservations = useCallback(async (showLoading = true) => {
    if (currentBranch.current !== branchId) return false;
    const generation = branchGeneration.current;
    const requestId = ++activeRequest.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation && activeRequest.current === requestId;
    if (!branchId) {
      activeRowsRef.current = [];
      setReservations([]);
      setLoading(false);
      return false;
    }
    if (showLoading || verificationRequired.current) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ branchId, scope: "active", _t: String(Date.now()) });
      const res = await fetchWithTimeout(`${RESERVATIONS_API}?${params.toString()}`);
      const payload: unknown = await readJsonWithTimeout(res).catch(() => null);
      if (!isCurrent()) return false;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("無法載入訂位，請重試");
      const data = payload as ReservationListResponse;
      if (!res.ok) {
        setError(data.error ?? "無法載入訂位");
        if (showLoading || verificationRequired.current) {
          activeRowsRef.current = [];
          publishRows();
        }
        return false;
      } else {
        if (!isReservationRows(data.items)) throw new Error("無法載入訂位，請重試");
        activeRowsRef.current = data.items;
        if (verificationRequired.current && !verificationInProgress.current) setError("請重新核對訂位資料後再繼續。");
        setActiveWarnings(data.warnings ?? []);
        publishRows();
      }
    } catch (e) {
      if (!isCurrent()) return false;
      setError(e instanceof Error ? e.message : "連線失敗");
      if (showLoading || verificationRequired.current) {
        activeRowsRef.current = [];
        publishRows();
      }
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
    // 歷史紀錄已載入過才一起刷新（保留已載入的筆數）
    if (isCurrent() && historyKeyRef.current !== null) void fetchHistory("refresh");
    return isCurrent();
  }, [branchId, fetchHistory, publishRows]);

  const refreshAfterMutation = useCallback(async () => {
    if (currentBranch.current !== branchId) return;
    const generation = branchGeneration.current;
    const checkedRealtimeVersion = realtimeVersion.current;
    const requestId = ++verificationRequest.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation && verificationRequest.current === requestId;
    verificationRequired.current = true;
    verificationInProgress.current = true;
    // A history request may have started before this mutation and may still
    // be pending even though no history page has been published yet.
    historyRequest.current += 1;
    focusLookupRequest.current += 1;
    focusLookupRef.current = null;
    extraRowsRef.current = [];
    publishRows();
    setHistoryLoading(false);
    setHistoryLoadingMore(false);
    setVerificationPending(true);
    const activeOk = await fetchReservations(true);
    if (!isCurrent()) return;
    const needsHistory = activeTab === "history" || historyKeyRef.current !== null;
    const historyOk = activeOk && (!needsHistory || await fetchHistory(historyKeyRef.current === null ? "replace" : "refresh"));
    if (!isCurrent()) return;
    const focusedId = focusReservationId;
    const existsInList = focusedId && [...activeRowsRef.current, ...historyRowsRef.current].some((row) => row.id === focusedId);
    const focusOk = activeOk && historyOk && (!focusedId || Boolean(existsInList) || await loadFocusedReservation(focusedId));
    if (!isCurrent()) return;
    verificationInProgress.current = false;
    if (activeOk && historyOk && focusOk && currentFocusId.current === focusReservationId && realtimeVersion.current === checkedRealtimeVersion) {
      verificationRequired.current = false;
      realtimePendingRef.current = false;
      setRealtimePending(false);
    } else {
      verificationRequired.current = true;
      setError((current) => current ?? "無法核對訂位資料，請重試。");
    }
    setVerificationPending(false);
  }, [activeTab, branchId, fetchHistory, fetchReservations, focusReservationId, loadFocusedReservation, publishRows]);

  // An earlier request may finish while this branch is being revisited. Reload
  // before allowing an editor to act on the older snapshot.
  useLayoutEffect(() => {
    const released = [...stalePendingMutations.current].filter((id) => !pendingMutations.has(id));
    for (const id of released) stalePendingMutations.current.delete(id);
    if (released.length > 0 && currentBranch.current === branchId && branchId) {
      void refreshAfterMutation();
    }
  }, [branchId, pendingMutations, refreshAfterMutation]);

  // 搜尋字輸入停 300ms 才送到伺服器（只用於歷史紀錄；未結案列表已全部載入，在本機篩選）
  useEffect(() => {
    const timer = setTimeout(() => setHistorySearch(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // 第一次打開歷史紀錄、或篩選條件改變時，才向伺服器要第一頁
  useEffect(() => {
    if (activeTab !== "history" || !branchId) return;
    if (historyKeyRef.current === historyKey) return;
    void fetchHistory("replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在分頁或篩選條件改變時觸發
  }, [activeTab, branchId, historyKey]);

  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  // 載入目前分店的付款設定（店名 / 匯款資訊 / LINE Pay），供繳費通知話術使用
  useEffect(() => {
    if (!branchId) {
      setBranchConfig(null);
      return;
    }
    let active = true;
    const generation = branchGeneration.current;
    const isCurrent = () => active && currentBranch.current === branchId && branchGeneration.current === generation;
    setBranchConfigStatus("loading");
    fetchWithTimeout(`/api/branches`)
      .then((res) => { if (!res.ok) throw new Error("branch config unavailable"); return readJsonWithTimeout(res); })
      .then((list: unknown) => {
        if (!isCurrent()) return;
        const found = Array.isArray(list)
          ? (list as BranchPaymentConfig & { id?: string }[]).find(
              (b) => (b as { id?: string }).id === branchId
            )
          : null;
        if (!found || !Object.prototype.hasOwnProperty.call(found, "payment_info") || !Object.prototype.hasOwnProperty.call(found, "line_pay_url")) throw new Error("branch config unavailable");
        setBranchConfig(found as BranchPaymentConfig);
        setBranchConfigStatus("ready");
      })
      .catch(() => {
        if (isCurrent()) { setBranchConfig(null); setBranchConfigStatus("error"); }
      });
    return () => {
      active = false;
    };
  }, [branchId, branchConfigRetry]);

  useEffect(() => {
    if (!branchId) return;
    let timeoutId: NodeJS.Timeout;
    try {
      const channel = supabase
        .channel("reservations-changes")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "reservations" },
          (payload) => {
            const changedId = (payload?.new as { id?: unknown } | undefined)?.id ?? (payload?.old as { id?: unknown } | undefined)?.id;
            const editor = editingRef.current;
            if (editor && (typeof changedId !== "string" || changedId === editor.id)) {
              editStaleRef.current = true;
              setEditStale(true);
            }
            messagePreviewRequest.current += 1;
            batchRequest.current += 1;
            setMessageWorkbench(null);
            setMessageLoading(false);
            setMessageSubmitting(false);
            setBatchWorkbench(null);
            setBatchLoading(false);
            const eventVersion = ++realtimeVersion.current;
            const generation = branchGeneration.current;
            realtimePendingRef.current = true;
            setRealtimePending(true);
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
              if (currentBranch.current !== branchId || branchGeneration.current !== generation || realtimeVersion.current !== eventVersion) return;
              if (focusReservationId || editingRef.current || verificationRequired.current) void refreshAfterMutation();
              else void fetchReservations(false).then((ok) => {
                if (ok && currentBranch.current === branchId && branchGeneration.current === generation && realtimeVersion.current === eventVersion && !verificationRequired.current) {
                  realtimePendingRef.current = false;
                  setRealtimePending(false);
                }
              });
            }, 500);
          }
        )
        .subscribe();
      // Changing focus or tabs resubscribes and cancels the old debounce. Keep
      // the refresh barrier in place until the new view has been rechecked.
      if (realtimePendingRef.current) {
        const generation = branchGeneration.current;
        const version = ++realtimeVersion.current;
        timeoutId = setTimeout(() => {
          if (currentBranch.current === branchId && branchGeneration.current === generation && realtimeVersion.current === version) void refreshAfterMutation();
        }, 500);
      }
      return () => {
        clearTimeout(timeoutId);
        supabase.removeChannel(channel);
      };
    } catch {
      return undefined;
    }
  }, [branchId, focusReservationId, fetchReservations, refreshAfterMutation]);

  const openEdit = useCallback((r: Reservation) => {
    if (realtimePendingRef.current || reservationMutationsSnapshot().has(r.id)) {
      showToast("此訂位正在處理，請稍候並重新確認資料。", "info");
      return;
    }
    editStaleRef.current = false;
    setEditStale(false);
    editingRef.current = r;
    setEditing(r);
    setEditName(r.customer_name);
    setEditPhone(r.phone);
    const startParts = toTaiwanParts(r.start_time);
    const endParts = toTaiwanParts(r.end_time);
    setEditDate(startParts.date);
    setEditTime(startParts.time);
    const diffHours = (endParts.ms - startParts.ms) / (60 * 60 * 1000);
    setEditDuration(diffHours >= 2 ? Math.round(diffHours * 2) / 2 : 2);
    setEditTotalPrice(r.total_price != null ? Number(r.total_price) : "");
    setEditGuestCount(r.guest_count ?? "");
    setEditNotes(r.notes ?? "");
    setEditStatus(r.status as ReservationStatus);
    setEditError(null);
  }, [showToast]);

  const closeEdit = () => {
    editingRef.current = null;
    editStaleRef.current = false;
    setEditStale(false);
    setEditing(null);
    setEditError(null);
  };

  useEffect(() => {
    if (!focusReservationId) {
      openedFocusReservationId.current = null;
      return;
    }
    if (
      loading || verificationPending ||
      editing ||
      openedFocusReservationId.current === focusReservationId
    ) {
      return;
    }
    const target = reservations.find((reservation) => reservation.id === focusReservationId);
    if (!target) {
      // 連結指到的訂位不在目前範圍（例如較早的歷史紀錄）：單獨向伺服器要這一筆
      if (!branchId || focusLookupRef.current === focusReservationId) return;
      const generation = branchGeneration.current;
      const request = loadFocusedReservation(focusReservationId);
      const requestId = focusLookupRequest.current;
      void request.then((ok) => {
        if (!ok && branchGeneration.current === generation && currentBranch.current === branchId && currentFocusId.current === focusReservationId && focusLookupRequest.current === requestId) {
          setError("無法讀取指定訂位，請重試。");
        }
      });
      return;
    }
    openedFocusReservationId.current = focusReservationId;
    openEdit(target);
  }, [branchId, editing, focusReservationId, loading, verificationPending, loadFocusedReservation, openEdit, reservations]);

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || currentBranch.current !== branchId || realtimePendingRef.current || editStaleRef.current) return;
    const generation = branchGeneration.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation;
    const reservationId = editing.id;
    if (!beginMutation(reservationId)) {
      setEditError("此訂位正在處理，請稍候並重新確認資料。");
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    let requestStarted = false;
    try {
      const start = new Date(`${editDate}T${editTime}:00+08:00`);
      const end = new Date(start.getTime() + editDuration * 60 * 60 * 1000);
      const totalPrice =
        editTotalPrice === "" ? null : Number(editTotalPrice);
      requestStarted = true;
      const res = await fetchWithTimeout(`${RESERVATIONS_API}/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: editName.trim(),
          phone: editPhone.trim(),
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          total_price: totalPrice,
          guest_count: editGuestCount === "" ? null : Number(editGuestCount),
          notes: editNotes.trim() || null,
          status: editStatus,
        }),
      });
      const data = responseObject(await readJsonWithTimeout(res)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || data?.ok !== true) markReservationMutationUnknown(reservationId);
      if (!isCurrent()) return;
      setEditSubmitting(false);
      if (!res.ok) {
        closeEdit();
        showToast(`${data?.error ?? "無法確認編輯結果"}；請核對最新資料後再操作。`, "error");
        await refreshAfterMutation();
        return;
      }
      if (data?.ok !== true) throw new Error("unknown result");
      closeEdit();
      await refreshAfterMutation();
    } catch (e) {
      if (requestStarted) markReservationMutationUnknown(reservationId);
      if (!isCurrent()) return;
      setEditSubmitting(false);
      if (!requestStarted) { setEditError(e instanceof Error ? e.message : "無法更新"); return; }
      closeEdit();
      showToast("無法確認編輯結果；請核對最新資料後再操作。", "error");
      await refreshAfterMutation();
    } finally {
      endReservationMutation(reservationId);
    }
  };

  const restoreReservation = async (id: string) => {
    if (restoringId || currentBranch.current !== branchId) return;
    const generation = branchGeneration.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation;
    const ok = await openConfirm(
      "還原訂位",
      "確定要還原這筆訂位嗎？原時段若已被其他訂位佔用將無法還原。還原不會改變付款狀態，也不會自動傳 LINE 給客人；先點的餐需重新確認。"
    );
    if (!ok || !isCurrent()) return;
    if (!beginMutation(id)) { showToast("此訂位正在處理，請稍候並重新確認資料。", "info"); return; }
    setRestoringId(id);
    try {
      const res = await fetchWithTimeout(`${RESERVATIONS_API}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "restore" }),
      });
      const data = responseObject(await readJsonWithTimeout(res).catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.status >= 500 || !data || (res.ok && data.ok !== true)) markReservationMutationUnknown(id);
      if (!isCurrent()) return;
      if (!res.ok) {
        showToast(`${data?.error ?? "無法確認還原結果"}；請核對最新資料後再操作。`, "error");
        await refreshAfterMutation();
        return;
      }
      if (data?.ok !== true) throw new Error("unknown result");
      showToast("已還原訂位", "success");
      await refreshAfterMutation();
    } catch {
      markReservationMutationUnknown(id);
      if (isCurrent()) {
        showToast("無法確認還原結果；請核對最新資料後再操作。", "error");
        await refreshAfterMutation();
      }
    } finally {
      endReservationMutation(id);
      if (isCurrent()) setRestoringId(null);
    }
  };

  /** 切換分頁；歷史紀錄預設新到舊，其他分頁預設早到晚（使用者之後仍可自行改排序）。 */
  const selectTab = (tab: "pending" | "upcoming" | "history") => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setSortBy(tab === "history" ? "time_desc" : "time_asc");
  };

  const updateStatus = async (id: string, status: ReservationStatus) => {
    if (currentBranch.current !== branchId) return;
    const generation = branchGeneration.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation;
    if (!beginMutation(id)) { showToast("此訂位正在處理，請稍候並重新確認資料。", "info"); return; }
    setReservations((list) =>
      list.map((r) => (r.id === id ? { ...r, status } : r))
    );
    try {
      const res = await fetchWithTimeout(`${RESERVATIONS_API}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = responseObject(await readJsonWithTimeout(res).catch(() => null)) as { ok?: boolean; error?: string; lineResult?: string | null } | null;
      if (res.status >= 500 || !data || (res.ok && data.ok !== true)) markReservationMutationUnknown(id);
      if (!isCurrent()) return;
      if (!res.ok) {
        showToast(data?.error ?? "無法確認狀態更新結果", "error");
        await refreshAfterMutation();
        return;
      }
      if (data?.ok !== true) throw new Error("unknown result");
      await refreshAfterMutation();
      if (!isCurrent()) return;
      const lineResult = data.lineResult;
      if (
        status === "confirmed" &&
        lineResult &&
        !["sent", "skipped_already_sent", "skipped_paid"].some((value) =>
          lineResult === value || lineResult.startsWith(`${value}:`)
        )
      ) {
        showToast(`訂位已更新，但 LINE 繳費通知未發送：${lineResult}`, "error");
      }
    } catch {
      markReservationMutationUnknown(id);
      if (!isCurrent()) return;
      showToast("連線中斷，狀態可能已更新；請先重新整理確認。", "error");
      await refreshAfterMutation();
    } finally {
      endReservationMutation(id);
    }
  };

  const updateDepositStatus = async (id: string, is_deposit_paid: boolean, info?: DepositInfo) => {
    if (currentBranch.current !== branchId) return;
    const generation = branchGeneration.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation;
    const row = reservations.find((r) => r.id === id);
    if (is_deposit_paid && (row?.pending_payment_reviews ?? 0) > 0) {
      const ok = await openConfirm(
        "付款待審核",
        `此訂位有 ${row?.pending_payment_reviews} 筆付款待審核。\n\n建議至「付款審核」頁面核准，避免與 LINE 截圖審核流程脫鉤。\n\n仍要手動標記已付訂金？`
      );
      if (!ok || !isCurrent()) return;
    }
    if (!beginMutation(id)) { showToast("此訂位正在處理，請稍候並重新確認資料。", "info"); return; }
    setReservations((list) =>
      list.map((r) =>
        r.id === id ? { ...r, is_deposit_paid, ...info } : r
      )
    );
    try {
      const payload: { is_deposit_paid: boolean } & Partial<DepositInfo> = { is_deposit_paid, ...info };
      const res = await fetchWithTimeout(`${RESERVATIONS_API}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = responseObject(await readJsonWithTimeout(res).catch(() => null)) as { ok?: boolean; error?: string; paymentNotification?: { status?: string; error?: string } | null } | null;
      if (res.status >= 500 || !data || (res.ok && data.ok !== true)) markReservationMutationUnknown(id);
      if (!isCurrent()) return;
      if (!res.ok) {
        showToast(data?.error ?? "無法確認訂金狀態更新結果", "error");
        await refreshAfterMutation();
        return;
      }
      if (data?.ok !== true) throw new Error("unknown result");
      await refreshAfterMutation();
      if (!isCurrent()) return;
      if (
        is_deposit_paid &&
        data.paymentNotification &&
        !["accepted_by_platform", "already_notified"].includes(data.paymentNotification.status ?? "")
      ) {
        showToast(
          `訂金已記錄，但 LINE 通知未完成：${data.paymentNotification.error ?? data.paymentNotification.status}`,
          "error"
        );
      } else {
        showToast(is_deposit_paid ? "已核准訂金並記錄" : "已改為未付訂金", "success");
      }
    } catch {
      markReservationMutationUnknown(id);
      if (!isCurrent()) return;
      showToast("連線中斷，訂金狀態可能已更新；請先重新整理確認。", "error");
      await refreshAfterMutation();
    } finally {
      endReservationMutation(id);
    }
  };

  const updateDepositInfo = async (id: string, info: DepositInfo) => {
    if (currentBranch.current !== branchId) return;
    const generation = branchGeneration.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation;
    if (!beginMutation(id)) { showToast("此訂位正在處理，請稍候並重新確認資料。", "info"); return; }
    setReservations((list) =>
      list.map((r) => (r.id === id ? { ...r, ...info } : r))
    );
    try {
      const res = await fetchWithTimeout(`${RESERVATIONS_API}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(info),
      });
      const data = responseObject(await readJsonWithTimeout(res).catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.status >= 500 || !data || (res.ok && data.ok !== true)) markReservationMutationUnknown(id);
      if (!isCurrent()) return;
      if (!res.ok) {
        showToast(data?.error ?? "無法確認付款資料更新結果", "error");
        await refreshAfterMutation();
        return;
      }
      if (data?.ok !== true) throw new Error("unknown result");
      await refreshAfterMutation();
      if (!isCurrent()) return;
      showToast("已更新付款資料", "success");
    } catch {
      markReservationMutationUnknown(id);
      if (!isCurrent()) return;
      showToast("連線中斷，付款資料可能已更新；請先重新整理確認。", "error");
      await refreshAfterMutation();
    } finally {
      endReservationMutation(id);
    }
  };

  const deleteReservation = async (id: string) => {
    if (currentBranch.current !== branchId) return;
    const generation = branchGeneration.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation;
    if (!beginMutation(id)) { showToast("此訂位正在處理，請稍候並重新確認資料。", "info"); return; }
    try {
      const res = await fetchWithTimeout(`${RESERVATIONS_API}/${id}`, { method: "DELETE" });
      const data = responseObject(await readJsonWithTimeout(res).catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.status >= 500 || !data || (res.ok && data.ok !== true)) markReservationMutationUnknown(id);
      if (!isCurrent()) return;
      if (!res.ok) {
        showToast(`${data?.error ?? "無法確認刪除結果"}；請核對最新資料後再操作。`, "error");
        await refreshAfterMutation();
        return;
      }
      if (data?.ok !== true) throw new Error("unknown result");
      await refreshAfterMutation();
    } catch {
      markReservationMutationUnknown(id);
      if (isCurrent()) {
        showToast("無法確認刪除結果；請核對最新資料後再操作。", "error");
        await refreshAfterMutation();
      }
    } finally {
      endReservationMutation(id);
    }
  };

  const handleSendLine = async () => {
    if (currentBranch.current !== branchId) return;
    const generation = branchGeneration.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation;
    const ok = await openConfirm(
      "發送明日提醒",
      "確定要手動發送明日訂位提醒嗎？\n\n僅會發送「尚未通知」的訂位，不會重複推播已發送過的。"
    );
    if (!ok || !isCurrent()) return;
    setSendingLine(true);
    try {
      const res = await fetchWithTimeout("/api/admin/reminders/send-line", { method: "POST" });
      const data = await readJsonWithTimeout<{ error?: string; message?: string; sent?: number }>(res);
      if (!isCurrent()) return;
      if (!res.ok) throw new Error(data.error || "發送失敗");
      showToast(data.message || `成功發送，共 ${data.sent} 筆`, "success");
      fetchReservations(false);
    } catch {
      if (isCurrent()) showToast("無法確認提醒是否已送出；請先核對通知紀錄，勿立即重送。", "error");
    } finally {
      if (isCurrent()) setSendingLine(false);
    }
  };

  const sendPaymentRequest = async (id: string) => {
    if (currentBranch.current !== branchId) return;
    if (!beginMutation(id)) { showToast("此訂位正在處理，請稍候並重新確認資料。", "info"); return; }
    const generation = branchGeneration.current;
    const isCurrent = () => currentBranch.current === branchId && branchGeneration.current === generation;
    try {
      const res = await fetchWithTimeout("/api/reservations/send-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = responseObject(await readJsonWithTimeout(res).catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.status >= 500 || !data || (res.ok && data.ok !== true)) markReservationMutationUnknown(id);
      if (!isCurrent()) return;
      if (!res.ok && res.status >= 500) showToast("無法確認 LINE 是否已接受，請先核對通知紀錄，勿立即重送。", "error");
      else if (!res.ok) showToast(`傳送失敗：${data?.error ?? "無法確認結果"}`, "error");
      else if (data?.ok !== true) showToast("無法確認 LINE 是否已接受，請先核對通知紀錄，勿立即重送。", "error");
      else showToast("LINE 平台已接受繳費通知（不代表客人手機已收到）", "success");
    } catch {
      markReservationMutationUnknown(id);
      if (isCurrent()) showToast("無法確認 LINE 是否已接受，請先核對通知紀錄，勿立即重送。", "error");
    } finally {
      endReservationMutation(id);
    }
  };

  if (!branchId) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-8 text-center text-gray-500">
        請先選擇分店以查看訂位
      </div>
    );
  }

  if (loading || verificationPending) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
        載入中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
        <p role="alert">{error}</p>
        <button type="button" onClick={() => void refreshAfterMutation()} className="mt-2 rounded border border-red-300 bg-white px-3 py-2 text-sm">重試</button>
      </div>
    );
  }

  const pendingList = reservations.filter((r) => r.status === "pending");
  const upcomingList = reservations.filter((r) =>
    ["confirmed", "paid", "checked_in"].includes(r.status)
  );
  // 歷史紀錄的範圍、狀態與搜尋已在伺服器端套用；這裡再套一次狀態，讓剛在畫面上改狀態的訂位也守同樣的篩選
  const historyList = reservations.filter(
    (r) =>
      TERMINAL_STATUSES.includes(r.status) &&
      (historyStatus === "all" ||
        (historyStatus === "auto_cancelled" ? Boolean(r.deposit_auto_cancelled) : r.status === historyStatus))
  );
  const onlyDepositAutoCancelled = historyStatus === "auto_cancelled";
  const pendingCount = pendingList.length;
  const listWarnings = [...activeWarnings, ...(activeTab === "history" ? historyWarnings : [])];

  const listForTab =
    activeTab === "pending" ? pendingList : activeTab === "upcoming" ? upcomingList : historyList;

  const REGULAR_CUSTOMER_THRESHOLD = 3;
  const phoneCounts = new Map<string, number>();
  reservations.forEach((r) => {
    if (r.status === "cancelled" || !r.phone) return;
    phoneCounts.set(r.phone, (phoneCounts.get(r.phone) ?? 0) + 1);
  });
  // 伺服器有算整個分店的次數（visit_count）就用它；只看已載入的列表會低估
  const visitCountOf = (r: Reservation) => r.visit_count ?? phoneCounts.get(r.phone) ?? 0;

  const roomNameMap = new Map(rooms.map((r) => [r.id, r.name]));
  const query = normalizeText(searchTerm.trim());
  const filteredList = listForTab.filter((r) => {
    if (!query) return true;
    const roomName = roomNameMap.get(r.room_id) ?? "";
    const haystack = [
      r.customer_name,
      r.phone,
      r.booking_code ?? "",
      roomName,
      r.notes ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return normalizeText(haystack).includes(query);
  });
  const sortedList = [...filteredList].sort((a, b) => {
    switch (sortBy) {
      case "time_desc":
        return b.start_time.localeCompare(a.start_time);
      case "price_desc":
        return (Number(b.total_price) || 0) - (Number(a.total_price) || 0);
      case "price_asc":
        return (Number(a.total_price) || 0) - (Number(b.total_price) || 0);
      case "time_asc":
      default:
        return a.start_time.localeCompare(b.start_time);
    }
  });
  const showDateGroup = sortBy === "time_asc" || sortBy === "time_desc";
  const displayList: Array<{ type: "date"; date: string } | { type: "item"; item: Reservation }> =
    [];
  if (showDateGroup) {
    let lastDate = "";
    sortedList.forEach((r) => {
      const dateKey = reservationDateKey(r.start_time);
      if (dateKey !== lastDate) {
        displayList.push({ type: "date", date: dateKey });
        lastDate = dateKey;
      }
      displayList.push({ type: "item", item: r });
    });
  } else {
    sortedList.forEach((r) => displayList.push({ type: "item", item: r }));
  }
  const visibleReservationIds = new Set(sortedList.map((reservation) => reservation.id));
  const uncertainReservations = [...pendingMutations].filter(([, state]) => state.branchId === branchId && state.outcome === "unknown");
  const visibleSelectedCount = selectedReservationIds.filter((id) => visibleReservationIds.has(id)).length;
  const hiddenSelectedCount = selectedReservationIds.length - visibleSelectedCount;
  const selectableIds = sortedList.filter((reservation) => !pendingMutations.has(reservation.id)).map((reservation) => reservation.id);
  const selectableSelectedCount = selectableIds.filter((id) => selectedReservationIds.includes(id)).length;
  const allVisibleSelected = selectableIds.length > 0 && selectableSelectedCount === selectableIds.length;
  const someVisibleSelected = selectableSelectedCount > 0 && !allVisibleSelected;

  return (
    <>
      {realtimePending && <p role="status" className="mx-4 my-2 text-sm text-amber-800">資料正在更新，請稍候並重新確認。</p>}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2">
        <button
          type="button"
          onClick={() => selectTab("pending")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${activeTab === "pending"
            ? "bg-amber-600 text-white"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
        >
          待審核
          {pendingCount > 0 && (
            <span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => selectTab("upcoming")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${activeTab === "upcoming"
            ? "bg-amber-600 text-white"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
        >
          即將到來
        </button>
        <button
          type="button"
          onClick={() => selectTab("history")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${activeTab === "history"
            ? "bg-amber-600 text-white"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
        >
          歷史紀錄
        </button>
        <button
          type="button"
          onClick={handleSendLine}
          disabled={sendingLine}
          className="ml-auto flex min-h-11 items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {sendingLine ? "發送中..." : "發送 LINE 明日提醒"}
        </button>
      </div>
      {activeTab === "history" && (
        <div className="mb-3 space-y-2 px-4" aria-label="歷史紀錄篩選">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="期間">
            {HISTORY_RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setHistoryRange(option.value)}
                aria-pressed={historyRange === option.value}
                className={`min-h-9 rounded-full px-3 py-1 text-xs font-medium ${historyRange === option.value
                  ? "bg-stone-800 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="狀態">
            {HISTORY_STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setHistoryStatus(option.value)}
                aria-pressed={historyStatus === option.value}
                className={`min-h-9 rounded-full px-3 py-1 text-xs font-medium ${historyStatus === option.value
                  ? "bg-amber-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setHistoryStatus((v) => (v === "auto_cancelled" ? "all" : "auto_cancelled"))}
              aria-pressed={onlyDepositAutoCancelled}
              className={`min-h-9 rounded-full px-3 py-1 text-xs font-medium ${onlyDepositAutoCancelled
                ? "bg-red-600 text-white"
                : "bg-red-50 text-red-700 hover:bg-red-100"
                }`}
            >
              只看未付訂金自動取消{onlyDepositAutoCancelled && historyTotal != null ? `（${historyTotal}）` : ""}
            </button>
          </div>
        </div>
      )}

      {listWarnings.length > 0 && (
        <p className="mx-4 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
          部分資料暫時無法載入：{listWarnings.join("、")}。列表仍可使用，可稍後重新整理。
        </p>
      )}

      {uncertainReservations.length > 0 && <div role="alert" className="mx-4 mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p>以下訂位的操作結果尚未確認：{uncertainReservations.map(([, state]) => state.label).join("、")}。請先核對訂位、付款或通知紀錄；原請求仍可能稍後完成。</p>
        <button type="button" className="mt-2 rounded border border-amber-400 bg-white px-3 py-2" onClick={async () => {
          const generation = branchGeneration.current;
          const acknowledged = uncertainReservations;
          const ok = await openConfirm("解除待確認", "請先與店員核對列出的每筆操作及相關紀錄。原請求仍可能稍後完成，解除後再操作可能重複。確認已核對並要解除嗎？");
          if (!ok || currentBranch.current !== branchId || branchGeneration.current !== generation) return;
          for (const [id, state] of acknowledged) {
            stalePendingMutations.current.delete(id);
            clearReservationMutationUnknown(id, state);
          }
          await refreshAfterMutation();
        }}>核對後解除待確認</button>
      </div>}

      {branchConfigStatus === "loading" && <p role="status" className="mx-4 mb-3 text-sm text-gray-600">正在讀取分店繳費設定，暫無法複製繳費通知。</p>}
      {branchConfigStatus === "error" && <p role="status" className="mx-4 mb-3 text-sm text-amber-800">無法讀取或無權查看分店繳費設定，暫無法複製繳費通知。 <button type="button" className="underline" onClick={() => { setBranchConfigStatus("loading"); setBranchConfigRetry((value) => value + 1); }}>重試</button></p>}
      {branchConfigStatus === "ready" && !branchConfig?.payment_info && !branchConfig?.line_pay_url && <p role="status" className="mx-4 mb-3 text-sm text-amber-800">此分店尚未設定匯款或 LINE Pay 資訊，複製內容會請客人依店內指示付款。</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2 px-4">
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            ref={(element) => { if (element) element.indeterminate = someVisibleSelected; }}
            disabled={selectableIds.length === 0}
            onChange={(event) => selectVisibleReservations(selectableIds, event.target.checked)}
            aria-label="選取目前列表訂位"
            className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          全選目前可用訂位
        </label>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-64"
          placeholder="搜尋姓名/電話/代號/包廂/備註"
          aria-label="搜尋訂位"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="time_asc">時間：早 → 晚</option>
          <option value="time_desc">時間：晚 → 早</option>
          <option value="price_desc">金額：高 → 低</option>
          <option value="price_asc">金額：低 → 高</option>
        </select>
        <span className="text-xs text-gray-500">
          {activeTab === "history" && historyTotal != null && historyTotal > sortedList.length
            ? `已顯示 ${sortedList.length}／共 ${historyTotal} 筆`
            : `共 ${sortedList.length} 筆`}
        </span>
      </div>

      {selectedReservationIds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3" role="status">
          <span className="text-sm font-semibold text-indigo-900">已選取 {selectedReservationIds.length} 筆訂位</span>
          <span className="text-sm text-indigo-900">目前清單 {visibleSelectedCount} 筆{hiddenSelectedCount > 0 ? `，清單外 ${hiddenSelectedCount} 筆（包含其他分頁、篩選或尚未載入的訂位）` : ""}</span>
          <button
            type="button"
            onClick={() => selectVisibleReservations(selectableIds, true)}
            className="min-h-11 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100"
          >
            加選目前列表
          </button>
          <button
            type="button"
            onClick={() => void openBatchDepositWorkbench()}
            disabled={batchLoading}
            className="min-h-11 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {batchLoading ? "產生預覽中…" : "批次複製訂金訊息"}
          </button>
          <button
            type="button"
            onClick={() => { batchRequest.current += 1; setBatchLoading(false); setBatchWorkbench(null); setSelectedReservationIds([]); }}
            className="min-h-11 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-white"
          >
            清除選取
          </button>
        </div>
      )}

      {activeTab === "history" && historyError && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {historyError}
          <button
            type="button"
            onClick={() => void fetchHistory("replace")}
            className="ml-2 font-semibold underline"
          >
            重試
          </button>
        </p>
      )}

      {query && sortedList.length === 0 && !historyLoading && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          找不到符合「{searchTerm.trim()}」的訂位，請調整關鍵字或切換分頁
          {activeTab === "history" && historyRange !== "all" ? "；較早的紀錄請把期間改成「全部」" : ""}。
        </p>
      )}

      {!query && sortedList.length === 0 && !(activeTab === "history" && (historyLoading || historyError)) && (
        <div className="mb-3 rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
          {activeTab === "history"
            ? historyRange === "all"
              ? "尚無歷史紀錄"
              : "這段期間沒有歷史紀錄，可改選較長的期間或「全部」"
            : reservations.length === 0
              ? "尚無訂位資料"
              : activeTab === "pending"
                ? "目前沒有待審核的訂位"
                : "目前沒有即將到來的訂位"}
        </div>
      )}

      {activeTab === "history" && historyLoading && (
        <div className="mb-3 rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500" role="status">
          載入中…
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <ul className="divide-y divide-gray-100">
          {displayList.map((row) => {
            if (row.type === "date") {
              return (
                <li key={`date-${row.date}`} className="bg-gray-50 px-4 py-2 text-xs text-gray-500">
                  {formatReservationDateKey(row.date)}
                </li>
              );
            }
            const r = row.item;
            const roomName = roomNameMap.get(r.room_id) ?? "—";
            const visitCount = visitCountOf(r);
            return (
              <li key={r.id} aria-busy={pendingMutations.has(r.id)} className="space-y-2 p-4 hover:bg-gray-50/80">
                {/* Row 1: Name · Phone · Status */}
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedReservationIds.includes(r.id)}
                    disabled={realtimePending || pendingMutations.has(r.id)}
                    onChange={() => toggleReservationSelection(r.id)}
                    aria-label={`選取 ${r.customer_name} ${r.booking_code ?? ""} ${format(toTaipei(r.start_time), "yyyy/MM/dd")}`}
                    className="h-5 w-5 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-base font-semibold text-gray-900">{r.customer_name}</span>
                  <span className="text-sm text-gray-500">{r.phone}</span>
                  {visitCount >= REGULAR_CUSTOMER_THRESHOLD && (
                    <span
                      className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-200"
                      title={`此電話累積 ${visitCount} 筆未取消訂位`}
                    >
                      🌟 熟客 ×{visitCount}
                    </span>
                  )}
                  <span
                    className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status] ?? "bg-gray-100 text-gray-700"
                      }`}
                  >
                    {reservationStatusLabel(r.status)}
                  </span>
                  {r.deposit_auto_cancelled && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                      未付訂金自動取消
                    </span>
                  )}
                </div>
                {pendingMutations.has(r.id) && <p role="status" className="text-sm text-amber-800">此訂位正在處理，請稍候並重新確認資料。若長時間未完成，請先核對，勿重複送出。</p>}

                {/* Row 2: Room · Code · Guest count · Date · Time · Price */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                  <span className="flex items-center gap-1">
                    <DoorOpen className="h-3.5 w-3.5 text-gray-400" />
                    {roomName}
                  </span>
                  {r.booking_code && (
                    <span className="text-xs text-gray-500">
                      代號：<span className="font-mono">{r.booking_code}</span>
                    </span>
                  )}
                  {r.preorder && (
                    <div className={`mt-2 rounded-lg px-2.5 py-2 text-xs ${r.preorder.requires_reconfirmation ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
                      <span className="font-semibold">訂位時先點的餐：{r.preorder.requires_reconfirmation ? "需重新確認" : preorderStatusLabel(r.preorder.status)}</span>
                      {r.preorder.item_summary && <span className="ml-2">{r.preorder.item_summary}</span>}
                      {r.preorder.guest_notes && <span className="block mt-0.5">備註：{r.preorder.guest_notes}</span>}
                    </div>
                  )}
                  {r.status !== "cancelled" && <Link href={`/admin/reservation-orders/${r.id}`}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                    餐點管理／到店確認
                  </Link>}
                  {r.guest_count != null && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-gray-400" />
                      {r.guest_count} 人
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-gray-400" />
                    {format(toTaipei(r.start_time), "yyyy/MM/dd (EEE)", { locale: zhTW })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />
                    {format(toTaipei(r.start_time), "HH:mm")}–{format(toTaipei(r.end_time), "HH:mm")}
                  </span>
                  {r.total_price != null && (
                    <span className="font-medium text-gray-800">${Number(r.total_price)}</span>
                  )}
                  {activeTab === "history" && isDepositRequired(reservationDateKey(r.start_time)) && (
                    r.is_deposit_paid ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 border border-green-200">
                        ✅ 已付訂金
                        {(() => {
                          const detail = [transferInfoLabel(r), r.deposit_payment_note].filter(Boolean).join("・");
                          return detail ? `（${detail}）` : "";
                        })()}
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 border border-amber-200">
                        💰 需收訂金
                      </span>
                    )
                  )}
                  {activeTab === "history" && (r.pending_payment_reviews ?? 0) > 0 && (
                    <a
                      href="/admin/payments"
                      className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800 border border-violet-200 hover:bg-violet-200"
                    >
                      📋 付款待審核 ×{r.pending_payment_reviews}
                    </a>
                  )}
                  {r.guest_confirmed_at ? (
                    <span
                      className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 border border-sky-200"
                      title={`確認於 ${format(toTaipei(r.guest_confirmed_at), "MM/dd HH:mm", { locale: zhTW })}`}
                    >
                      已確認出席
                    </span>
                  ) : (
                    activeTab !== "history" &&
                    ["pending", "confirmed"].includes(r.status) &&
                    (r.is_notified ||
                      (() => {
                        const ms = new Date(r.start_time).getTime() - Date.now();
                        return ms >= 0 && ms <= 36 * 60 * 60 * 1000;
                      })()) && (
                      <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500 border border-gray-200">
                        待確認出席
                      </span>
                    )
                  )}
                </div>

                {/* Row 3: Notes (if any) */}
                {r.notes && (
                  <p className="text-sm text-gray-500 italic">備註：{r.notes}</p>
                )}

                {/* Structured Deposit Control */}
                {activeTab !== "history" && isDepositRequired(reservationDateKey(r.start_time)) && (
                  <div className="pt-1.5">
                    <DepositStatusControl
                      reservation={r}
                      isDepositRequired={true}
                      onUpdateDepositStatus={updateDepositStatus}
                      onUpdateDepositInfo={updateDepositInfo}
                      onOpenConfirm={openConfirm}
                    />
                  </div>
                )}

                {/* Row 4: Actions */}
                {activeTab === "pending" ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => updateStatus(r.id, "confirmed")}
                        disabled={realtimePending || pendingMutations.has(r.id)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      ✅ 確認
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await openConfirm("拒絕訂位", "確定要將此訂位標記為取消/拒絕嗎？");
                        if (!ok) return;
                        await updateStatus(r.id, "cancelled");
                      }}
                      className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    >
                      ❌ 拒絕
                    </button>
                    <button
                      type="button"
                      onClick={() => openMessageWorkbench(r)}
                      disabled={realtimePending || pendingMutations.has(r.id)}
                      className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      📝 訊息工作台
                    </button>
                    {isDepositRequired(reservationDateKey(r.start_time)) && r.total_price != null && !r.is_deposit_paid && (
                      <button
                        type="button"
                        disabled={realtimePending || branchConfigStatus !== "ready" || pendingMutations.has(r.id)}
                        onClick={async () => {
                          const branchName = r.room_with_branch?.branch?.name ?? "";
                          // 話術由分店設定驅動，與伺服器推播共用同一產生器，確保內容一致
                          const text = buildPaymentMessage({
                            customerName: r.customer_name,
                            startTime: r.start_time,
                            endTime: r.end_time,
                            total: Number(r.total_price),
                            branch: branchConfig ?? { name: branchName },
                            bookingCode: r.booking_code,
                            createdAt: r.created_at,
                          });
                          try {
                            if (navigator.clipboard?.writeText) {
                              await navigator.clipboard.writeText(text);
                            } else {
                              const textarea = document.createElement("textarea");
                              textarea.value = text;
                              document.body.appendChild(textarea);
                              textarea.select();
                              document.execCommand("copy");
                              document.body.removeChild(textarea);
                            }
                            showToast("已複製通知內容", "success");
                          } catch {
                            showToast("複製失敗，請手動複製。", "error");
                          }
                        }}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        📋 複製繳費通知
                      </button>
                    )}
                    {isDepositRequired(reservationDateKey(r.start_time)) && r.total_price != null && (
                      <button
                        type="button"
                        disabled={realtimePending || pendingMutations.has(r.id)}
                        onClick={() => void sendPaymentRequest(r.id)}
                        className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                      >
                        {pendingMutations.has(r.id) ? "處理中…" : "💬 重送 LINE 繳費"}
                      </button>
                    )}
                    {r.status === "cancelled" && (
                      <button
                        type="button"
                        onClick={() => restoreReservation(r.id)}
                        disabled={realtimePending || restoringId !== null || pendingMutations.has(r.id)}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {restoringId === r.id ? "還原中…" : "↩️ 還原"}
                      </button>
                    )}
                  </div>
                ) : activeTab === "upcoming" ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openMessageWorkbench(r)}
                      disabled={realtimePending || pendingMutations.has(r.id)}
                      className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      📝 訊息工作台
                    </button>
                    {r.status !== "checked_in" && r.status !== "completed" && (
                      <button
                        type="button"
                        onClick={() => updateStatus(r.id, "checked_in")}
                        disabled={realtimePending || pendingMutations.has(r.id)}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        ✅ 已到店
                      </button>
                    )}
                    {(r.status === "pending" || r.status === "confirmed") && new Date(r.start_time).getTime() <= Date.now() && (
                      <button
                        type="button"
                        onClick={() => updateStatus(r.id, "no_show")}
                        disabled={realtimePending || pendingMutations.has(r.id)}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        🚫 沒來
                      </button>
                    )}
                    {r.status !== "completed" && r.status !== "no_show" && (
                      <button
                        type="button"
                        onClick={() => updateStatus(r.id, "completed")}
                        disabled={realtimePending || pendingMutations.has(r.id)}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        💵 已完成
                      </button>
                    )}
                    {isDepositRequired(reservationDateKey(r.start_time)) && r.total_price != null && !r.is_deposit_paid && (
                      <button
                        type="button"
                        disabled={realtimePending || pendingMutations.has(r.id)}
                        onClick={() => void sendPaymentRequest(r.id)}
                        className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                      >
                        {pendingMutations.has(r.id) ? "處理中…" : "💬 重送 LINE 繳費"}
                      </button>
                    )}
                    {r.status !== "cancelled" && (
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await openConfirm("取消訂位", "確定要將此訂位標記為取消嗎？");
                          if (!ok) return;
                          await updateStatus(r.id, "cancelled");
                        }}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        ❌ 取消
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      disabled={realtimePending || pendingMutations.has(r.id)}
                      className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-100"
                      aria-label="編輯訂位"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await openConfirm(
                          "永久刪除",
                          "確定要永久刪除此訂位嗎？此動作無法復原！"
                        );
                        if (!ok) return;
                        await deleteReservation(r.id);
                      }}
                      disabled={realtimePending || pendingMutations.has(r.id)}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      🗑️ 刪除
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      disabled={realtimePending || pendingMutations.has(r.id)}
                      className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-100"
                      aria-label="檢視/編輯訂位"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {(r.status === "cancelled" || r.status === "no_show") && (
                      <button
                        type="button"
                        onClick={() => restoreReservation(r.id)}
                        disabled={realtimePending || restoringId !== null || pendingMutations.has(r.id)}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {restoringId === r.id ? "還原中…" : "↩️ 一鍵還原"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await openConfirm(
                          "刪除歷史",
                          "確定要永久刪除此訂位歷史嗎？此動作無法復原！"
                        );
                        if (!ok) return;
                        await deleteReservation(r.id);
                      }}
                      disabled={realtimePending || pendingMutations.has(r.id)}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      🗑️ 刪除
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {activeTab === "history" && historyCursor && !historyLoading && (
        <div className="mt-3 flex justify-center px-4">
          <button
            type="button"
            onClick={() => void fetchHistory("append")}
            disabled={historyLoadingMore}
            className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:w-auto"
          >
            {historyLoadingMore ? "載入中…" : "載入更多"}
          </button>
        </div>
      )}

      {messageWorkbench && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reservation-message-workbench-title"
        >
          <div className="flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <h2 id="reservation-message-workbench-title" className="text-lg font-semibold">
                  訊息工作台
                </h2>
                <p className="text-xs text-gray-500">
                  {messageWorkbench.customer_name} · {messageWorkbench.booking_code ?? "無訂位碼"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMessageWorkbench(null)}
                className="-mr-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="關閉訊息工作台"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
                {messageWorkbench.line_user_id
                  ? "此訂位已綁定官方 LINE；需要人工轉發時仍可使用複製工作台。"
                  : "此訂位尚未綁定官方 LINE；複製後請貼到員工與客人的 LINE 對話。"}
              </div>
              <div>
                <label htmlFor="reservation-message-template" className="mb-1 block text-sm font-medium text-gray-700">
                  訊息類型
                </label>
                <select
                  id="reservation-message-template"
                  value={messageTemplate}
                  onChange={(event) => {
                    const next = event.target.value as ReservationMessageTemplateKey;
                    setMessageTemplate(next);
                    void loadMessagePreview(messageWorkbench.id, next);
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {RESERVATION_MESSAGE_TEMPLATES.map((template) => (
                    <option key={template.key} value={template.key}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reservation-message-preview" className="mb-1 block text-sm font-medium text-gray-700">
                  預覽（系統會自動帶入訂位與分店付款資料）
                </label>
                <textarea
                  id="reservation-message-preview"
                  value={messageLoading ? "產生中…" : messageText}
                  readOnly
                  rows={12}
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-sm leading-6 text-gray-800"
                />
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3">
              <button
                type="button"
                onClick={() => void copyWorkbenchMessage()}
                disabled={messageLoading || messageSubmitting || !messageText}
                className="min-h-[44px] rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {messageSubmitting ? "處理中…" : "📋 產生並複製"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const recorded = await submitMessageAction("manual_sent");
                  if (recorded) {
                    showToast("已記錄人工傳送；這不是 LINE 送達回執", "success");
                    setMessageCopied(false);
                  }
                }}
                disabled={!messageCopied || messageLoading || messageSubmitting}
                className="min-h-[44px] rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                ✅ 標記已傳送
              </button>
            </div>
          </div>
        </div>
      )}

      {batchWorkbench && (
        <BatchDepositMessageWorkbench
          reservationIds={batchWorkbench.reservationIds}
          batchId={batchWorkbench.batchId}
          items={batchWorkbench.items}
          combinedText={batchWorkbench.combinedText}
          canBatchCopy={batchWorkbench.canBatchCopy}
          warnings={batchWorkbench.warnings}
          onClose={() => setBatchWorkbench(null)}
        />
      )}

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 overscroll-contain"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-reservation-title"
        >
          <div className="flex w-full max-h-[90dvh] sm:max-h-[85vh] sm:max-w-md flex-col rounded-t-2xl sm:rounded-xl bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
              <h2 id="edit-reservation-title" className="text-lg font-semibold">
                編輯訂位
              </h2>
              <button
                type="button"
                onClick={closeEdit}
                className="-mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="關閉"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitEdit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
                {editError && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{editError}</p>
                )}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">姓名 *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">電話 *</label>
                  <input
                    type="tel"
                    required
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">日期 *</label>
                    <input
                      type="date"
                      required
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">開始時間 *</label>
                    <input
                      type="time"
                      required
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">時數 *</label>
                  <select
                    value={editDuration}
                    onChange={(e) => setEditDuration(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  >
                    {Array.from({ length: 13 }, (_, i) => 2 + i * 0.5).map((h) => (
                      <option key={h} value={h}>{h} 小時</option>
                    ))}
                  </select>
                </div>
                {editing && (() => {
                  const room = rooms.find((ro) => ro.id === editing.room_id);
                  if (!room || !editDate) return null;
                  const pricePerHour = getPricePerHour(room, editDate);
                  const estimated = Math.round(pricePerHour * editDuration);
                  const kind = isWeekendDate(editDate) ? "假日" : "平日";
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <p>
                        預估總價：<strong>${estimated}</strong>（{kind} ${pricePerHour}/時 × {editDuration} 小時）
                      </p>
                      <button
                        type="button"
                        onClick={() => setEditTotalPrice(estimated)}
                        className="shrink-0 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
                      >
                        套用估算
                      </button>
                    </div>
                  );
                })()}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">總價</label>
                  <input
                    type="number"
                    min={0}
                    value={editTotalPrice === "" ? "" : editTotalPrice}
                    onChange={(e) =>
                      setEditTotalPrice(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                    placeholder="可依上方預估填寫"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">人數</label>
                  <input
                    type="number"
                    min={1}
                    value={editGuestCount === "" ? "" : editGuestCount}
                    onChange={(e) => setEditGuestCount(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                    placeholder="選填"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">備註</label>
                  <textarea
                    rows={2}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                    placeholder="選填"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">狀態</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as ReservationStatus)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              {editStale && <p role="alert" className="px-4 py-2 text-sm text-amber-800">此訂位可能已在其他地方更新。請關閉並重新開啟以檢查最新資料；目前輸入未自動儲存。</p>}
              <div className="flex shrink-0 gap-2 border-t border-gray-200 bg-white px-4 py-3">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="min-h-[44px] flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting || editStale || realtimePending || pendingMutations.has(editing.id)}
                  className="min-h-[44px] flex-1 rounded-lg bg-amber-600 px-4 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {editSubmitting ? "儲存中…" : "儲存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDialog != null}
        title={confirmDialog?.title ?? ""}
        message={confirmDialog?.message ?? ""}
        onConfirm={() => closeConfirm(true)}
        onCancel={() => closeConfirm(false)}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
