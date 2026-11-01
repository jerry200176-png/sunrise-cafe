"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { responseError } from "@/lib/friendly-error";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import type { DraftItemInput } from "@/lib/reservation-preorder";

// Only identifiers are durable. Meal contents and free text never go to browser storage.
export type PendingOrderAdd = { version: 2; reservationId: string; key: string };
const PREFIX = "sunrise.order-add.pending.v1:";
const storageKey = (reservationId: string, key: string) => `${PREFIX}${encodeURIComponent(reservationId)}:${key}`;

function readPending(reservationId: string): PendingOrderAdd[] {
  const prefix = `${PREFIX}${encodeURIComponent(reservationId)}:`;
  const found: PendingOrderAdd[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const storageId = localStorage.key(index);
    if (!storageId?.startsWith(prefix)) continue;
    const raw = localStorage.getItem(storageId);
    if (raw === null) continue;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") throw new Error("invalid pending record");
    const row = data as { version?: number; reservationId?: unknown; key?: unknown };
    if ((row.version !== 1 && row.version !== 2) || row.reservationId !== reservationId || typeof row.key !== "string" ||
        !/^[a-zA-Z0-9_-]{16,128}$/.test(row.key) || storageKey(reservationId, row.key) !== storageId) throw new Error("invalid pending record");
    const minimal: PendingOrderAdd = { version: 2, reservationId, key: row.key };
    const serialized = JSON.stringify(minimal);
    // Remove any sensitive contents from records created by pre-release versions.
    if (serialized !== raw) {
      localStorage.setItem(storageId, serialized);
      if (localStorage.getItem(storageId) !== serialized) throw new Error("storage write failed");
    }
    found.push(minimal);
  }
  return found;
}

const STORAGE_ERROR = "無法安全保存加點狀態，已暫停加點。請檢查瀏覽器儲存空間並聯絡管理者。";
const UNKNOWN = "加點結果尚未確認，請稍後再查詢或先安全取消，請勿另行加點。";
type Resolution = "committed" | "canceled";

/** Persist only a random request ID; unknown outcomes never become new orders automatically. */
export function useOrderAddRecovery(reservationId: string) {
  const [pending, setPending] = useState<PendingOrderAdd[]>([]);
  const [ready, setReady] = useState(false);
  const [loadedId, setLoadedId] = useState("");
  const [storageError, setStorageError] = useState("");
  const inFlight = useRef(false);
  const current = useRef(reservationId);
  current.current = reservationId;

  const refresh = useCallback(() => {
    try {
      const items = readPending(reservationId);
      if (current.current === reservationId) { setPending(items); setStorageError(""); setLoadedId(reservationId); setReady(true); }
      return items;
    } catch {
      if (current.current === reservationId) { setStorageError(STORAGE_ERROR); setLoadedId(reservationId); setReady(true); }
      throw new Error(STORAGE_ERROR);
    }
  }, [reservationId]);

  useEffect(() => {
    setReady(false); setPending([]); setStorageError("");
    try { refresh(); } catch { /* state contains the user-facing failure */ }
    const onStorage = () => { try { refresh(); } catch { /* already surfaced */ } };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  function clearResolved(record: PendingOrderAdd) {
    try {
      const key = storageKey(record.reservationId, record.key);
      localStorage.removeItem(key);
      if (localStorage.getItem(key) !== null) throw new Error("remove failed");
      if (current.current === reservationId) refresh();
    } catch {
      if (current.current === reservationId) setStorageError(STORAGE_ERROR);
    }
  }

  async function post(body: Record<string, unknown>) {
    const response = await fetchWithTimeout(`/api/admin/reservation-orders/${encodeURIComponent(reservationId)}`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseError(response));
    return readJsonWithTimeout<{ ok?: boolean; state?: string } & Record<string, unknown>>(response);
  }

  async function begin(items: DraftItemInput[]) {
    if (inFlight.current) throw new Error("加點仍在處理，請稍候。");
    inFlight.current = true;
    let storageWriteFailed = false;
    try {
      if (readPending(reservationId).length) throw new Error("有一筆加點結果待確認，請先處理。");
      if (!window.crypto?.randomUUID) throw new Error(STORAGE_ERROR);
      const record: PendingOrderAdd = { version: 2, reservationId, key: window.crypto.randomUUID() };
      const serialized = JSON.stringify(record);
      try {
        localStorage.setItem(storageKey(reservationId, record.key), serialized);
        if (localStorage.getItem(storageKey(reservationId, record.key)) !== serialized) throw new Error("write failed");
        refresh();
      } catch { storageWriteFailed = true; setStorageError(STORAGE_ERROR); throw new Error(STORAGE_ERROR); }
      const result = await post({ action: "add_items", items, idempotency_key: record.key });
      if (result.ok !== true) throw new Error("無法確認加點結果，請勿重新加點。");
      clearResolved(record);
      return result;
    } catch (error) {
      if (!storageWriteFailed) { try { refresh(); } catch { /* surfaced by refresh */ } }
      throw error;
    } finally { inFlight.current = false; }
  }

  async function resolve(record: PendingOrderAdd, action: "add_status" | "cancel_add"): Promise<Resolution> {
    if (inFlight.current) throw new Error("加點仍在處理，請稍候。");
    inFlight.current = true;
    try {
      const stored = readPending(reservationId).find((item) => item.key === record.key);
      if (!stored) throw new Error("這筆待確認加點已處理，請重新整理訂單。");
      const response = await post({ action, idempotency_key: stored.key });
      if (response.ok !== true || (response.state !== "committed" && response.state !== "canceled")) throw new Error(UNKNOWN);
      clearResolved(stored);
      return response.state;
    } finally { inFlight.current = false; }
  }

  const sameReservation = loadedId === reservationId;
  return { ready: ready && sameReservation, storageError: sameReservation ? storageError : "", pending: sameReservation ? pending : [], begin,
    check: (record: PendingOrderAdd) => resolve(record, "add_status"), cancel: (record: PendingOrderAdd) => resolve(record, "cancel_add") };
}
