"use client";

import { useRef, useState } from "react";

export type AddWarning = "unknown" | "committed_stale";

/** An in-memory reminder only; this is not an idempotency mechanism. */
export function useAddOutcomeWarning(id: string) {
  const records = useRef<Record<string, AddWarning>>({});
  const [, render] = useState(0);
  function mark(reservationId: string, warning: AddWarning) {
    records.current[reservationId] = warning;
    render((n) => n + 1);
  }
  function confirmBeforeAdd(reservationId: string) {
    const warning = records.current[reservationId];
    if (!warning) return true;
    const message = warning === "unknown"
      ? "上次加點結果仍未確認，原請求可能稍後完成。請先核對訂單並與同事確認。你已了解可能重複，仍要繼續加點嗎？"
      : "上次加點已完成，但畫面未更新。請先重新載入並核對訂單。你已核對並要繼續加點嗎？";
    if (!window.confirm(message)) return false;
    delete records.current[reservationId];
    render((n) => n + 1);
    return true;
  }
  return { warning: records.current[id], mark, confirmBeforeAdd };
}
