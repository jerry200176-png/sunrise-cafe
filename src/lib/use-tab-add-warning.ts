"use client";

import { useEffect, useState } from "react";
import { createSessionAddWarningResearch } from "@/lib/session-add-warning-research";

const listeners = new Set<() => void>();
let writeFailed = false;
function notify() { listeners.forEach((listener) => listener()); }
function store() {
  try { return createSessionAddWarningResearch(window.sessionStorage); } catch { return null; }
}
function read() {
  const instance = store();
  const snapshot = instance?.snapshot();
  return snapshot?.ok ? { available: !writeFailed, entries: snapshot.value.entries } : { available: false, entries: [] };
}
export function useTabAddWarning() {
  const [state, setState] = useState<{available: boolean; entries: Array<{n: string; status: string}>} | null>(null);
  useEffect(() => {
    const refresh = () => setState(read());
    listeners.add(refresh);
    refresh();
    return () => { listeners.delete(refresh); };
  }, []);
  function confirmationMessage() {
    const current = read();
    const messages = [];
    if (current.entries.length) messages.push("本分頁有尚需核對的加點紀錄，不一定屬於目前訂位；原請求可能稍後完成。請核對所有可能相關訂單並與同事確認。你仍要加點嗎？");
    if (!current.available) messages.push("無法保存分頁提醒；離開或重新整理後提示可能消失。請先核對訂單。你仍要加點嗎？");
    return messages.join("\n");
  }
  function begin() {
    const instance = store();
    const result = instance?.begin();
    if (!result?.ok) { writeFailed = true; notify(); return null; }
    notify();
    return { instance: instance!, operation: result.operation };
  }
  function mark(operation: ReturnType<typeof begin>, status: "unknown" | "committed" | "not_attempted") {
    if (!operation) return;
    if (!operation.instance.mark(operation.operation, status)) writeFailed = true;
    notify();
  }
  function acknowledgeRefreshed(operation: ReturnType<typeof begin>) {
    if (!operation) return;
    if (!operation.instance.acknowledgeCommitted(operation.operation)) writeFailed = true;
    notify();
  }
  function acknowledgeCommitted() {
    const instance = store();
    const snapshot = instance?.snapshot();
    if (!instance || !snapshot?.ok) { writeFailed = true; notify(); return; }
    if (!window.confirm("確認已核對本分頁所有可能相關的已提交加點？尚未確認的請求仍可能完成，相關提醒不會清除。")) return;
    for (const entry of snapshot.value.entries) {
      if (entry.status === "committed" && !instance.acknowledgeCommitted(entry.n)) writeFailed = true;
    }
    notify();
  }
  return { state, confirmationMessage, begin, mark, acknowledgeRefreshed, acknowledgeCommitted };
}
