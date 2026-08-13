"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { BatchReservationMessageItem } from "@/lib/reservation-message-batch";

type CopyState = "idle" | "copying" | "copied" | "error";

type Props = {
  reservationIds: string[];
  batchId: string;
  items: BatchReservationMessageItem[];
  combinedText: string;
  canBatchCopy: boolean;
  warnings: string[];
  onClose: () => void;
  onCompleted?: () => void;
};

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Continue to the synchronous fallback below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
  return copied;
}

async function recordCopied(reservationIds: string[], batchId: string): Promise<void> {
  const response = await fetch("/api/reservations/message-actions/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reservation_ids: reservationIds,
      template_key: "deposit_request",
      action: "copied",
      batch_id: batchId,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; warnings?: string[] };
  if (!response.ok) throw new Error(data.error ?? data.warnings?.join(" ") ?? "操作紀錄失敗");
}

export function BatchDepositMessageWorkbench({
  reservationIds,
  batchId,
  items,
  combinedText,
  canBatchCopy,
  warnings,
  onClose,
  onCompleted,
}: Props) {
  const [batchState, setBatchState] = useState<CopyState>("idle");
  const [itemStates, setItemStates] = useState<Record<string, CopyState>>({});
  const [message, setMessage] = useState<string | null>(null);

  const copyAll = async () => {
    if (!canBatchCopy || batchState === "copying") return;
    setBatchState("copying");
    setMessage(null);
    const copied = await copyText(combinedText);
    if (!copied) {
      setBatchState("error");
      setMessage("複製全部失敗；請改用每筆單獨複製或手動選取文字。未記錄為已複製。");
      return;
    }
    try {
      await recordCopied(reservationIds, batchId);
      setBatchState("copied");
      setMessage("已複製全部訊息；請貼到同一位客人的 LINE 對話。已複製不等於已傳送。");
      onCompleted?.();
    } catch (error) {
      setBatchState("error");
      setMessage(
        `文字已複製，但操作紀錄失敗：${error instanceof Error ? error.message : "請稍後重試"}`
      );
    }
  };

  const copyOne = async (item: BatchReservationMessageItem) => {
    if (itemStates[item.reservation_id] === "copying") return;
    setItemStates((current) => ({ ...current, [item.reservation_id]: "copying" }));
    setMessage(null);
    const copied = await copyText(item.text);
    if (!copied) {
      setItemStates((current) => ({ ...current, [item.reservation_id]: "error" }));
      setMessage(`「${item.booking_code ?? item.date_label}」複製失敗，請手動選取訊息。`);
      return;
    }
    try {
      await recordCopied([item.reservation_id], batchId);
      setItemStates((current) => ({ ...current, [item.reservation_id]: "copied" }));
      setMessage(`「${item.booking_code ?? item.date_label}」已複製；已複製不等於已傳送。`);
      onCompleted?.();
    } catch (error) {
      setItemStates((current) => ({ ...current, [item.reservation_id]: "error" }));
      setMessage(
        `「${item.booking_code ?? item.date_label}」文字已複製，但操作紀錄失敗：${error instanceof Error ? error.message : "請稍後重試"}`
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-deposit-message-title"
    >
      <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 id="batch-deposit-message-title" className="text-lg font-semibold text-gray-900">
              批次複製訂金訊息
            </h2>
            <p className="text-xs text-gray-500">每筆訊息仍獨立追蹤；複製不會改變付款狀態，也不會自動傳送。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"
            aria-label="關閉批次複製訊息"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900" role="alert">
              <p className="font-semibold">目前不能複製全部</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
              <p className="mt-2">仍可使用下方每筆「單獨複製」。</p>
            </div>
          )}
          {message && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900" role="status">{message}</p>}

          <div className="space-y-3">
            {items.map((item, index) => {
              const state = itemStates[item.reservation_id] ?? "idle";
              return (
                <article key={item.reservation_id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900">{index + 1}. {item.customer_name}</p>
                      <p className="text-sm text-gray-600">
                        {item.date_label} · 訂位碼：{item.booking_code ?? "無"} · 訂金：${item.deposit_amount}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyOne(item)}
                      disabled={state === "copying"}
                      className="min-h-11 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                    >
                      {state === "copying" ? "複製中…" : state === "copied" ? "已複製" : "單獨複製"}
                    </button>
                  </div>
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm leading-6 text-gray-800">{item.text}</pre>
                </article>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-white px-4 py-3">
          <span className="text-xs text-gray-500">批次編號：{batchId.slice(0, 8)}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">關閉</button>
            <button
              type="button"
              onClick={() => void copyAll()}
              disabled={!canBatchCopy || batchState === "copying"}
              className="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {batchState === "copying" ? "複製中…" : batchState === "copied" ? "已複製全部" : "複製全部"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
