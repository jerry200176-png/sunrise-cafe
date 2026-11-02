"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/copy-text";
import { messageCopyDigest } from "@/lib/message-copy-digest";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
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
  beginCopy: () => boolean;
  endCopy: () => void;
  copyBusy: boolean;
  isCurrent: () => boolean;
  onCompleted?: () => void;
};

async function recordCopied(reservationIds: string[], batchId: string, mode: "all" | "single", digests: Array<{ id: string; digest: string }>, combinedDigest?: string): Promise<void> {
  const response = await fetchWithTimeout("/api/reservations/message-actions/batch/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reservation_ids: reservationIds,
      template_key: "deposit_request",
      action: "copied",
      batch_id: batchId, version: 2, mode, digests, ...(combinedDigest ? { combined_digest: combinedDigest } : {}),
    }),
  });
  const data = (await readJsonWithTimeout(response)) as { action_ids?: unknown; batch_id?: string; ok?: unknown; version?: unknown };
  if (!response.ok || data.ok !== true || data.version !== 2 || data.batch_id !== batchId || !Array.isArray(data.action_ids) || data.action_ids.length !== reservationIds.length || !data.action_ids.every((id) => typeof id === "string" && id.length > 0)) throw new Error("結果未確認");
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
  beginCopy, endCopy, copyBusy, isCurrent,
}: Props) {
  const [batchState, setBatchState] = useState<CopyState>("idle");
  const [itemStates, setItemStates] = useState<Record<string, CopyState>>({});
  const [message, setMessage] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [unknown, setUnknown] = useState(false);
  const valid = () => mounted.current && isCurrent();

  const copy = async (text: string, ids: string[], label: string, mode: "all" | "single", update: (state: CopyState) => void) => {
    if (unknown || !beginCopy()) return;
    update("copying");
    setMessage(null);
    try {
      const copied = await copyText(text);
      if (!valid()) return;
      if (!copied) {
        update("error");
        setMessage("複製失敗，請手動選取訊息；未送出操作紀錄。");
        return;
      }
      let digests: Array<{ id: string; digest: string }>;
      let combinedDigest: string | undefined;
      try {
        const selected = items.filter((item) => ids.includes(item.reservation_id));
        if (selected.length !== ids.length) throw new Error("missing item");
        digests = await Promise.all(selected.map(async (item) => ({ id: item.reservation_id, digest: await messageCopyDigest(item.text) })));
        if (mode === "all") combinedDigest = await messageCopyDigest(text);
      } catch {
        if (valid()) { update("error"); setMessage("文字已複製，無法驗證內容，未送出操作紀錄；請人工核對。"); }
        return;
      }
      if (!valid()) return;
      try {
        await recordCopied(ids, batchId, mode, digests, combinedDigest);
        if (!valid()) return;
        update("copied");
        setMessage(mode === "all" ? "已複製全部訊息；已複製不等於已傳送。" : `${label}已複製；已複製不等於已傳送。`);
        onCompleted?.();
      } catch {
        if (!valid()) return;
        update("error");
        setUnknown(true);
        setMessage("文字已複製，但操作紀錄結果未確認；請先核對，勿重複操作。");
      }
    } finally {
      endCopy();
    }
  };

  const copyAll = () => {
    if (!canBatchCopy) return;
    void copy(combinedText, reservationIds, "全部訊息", "all", setBatchState);
  };
  const copyOne = (item: BatchReservationMessageItem) => {
    if (item.error) return;
    void copy(item.text, [item.reservation_id], `「${item.booking_code ?? item.date_label}」`, "single",
      (state) => setItemStates((current) => ({ ...current, [item.reservation_id]: state })));
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
                        {item.date_label} · 訂位碼：{item.booking_code ?? "無"} · 訂金：{item.deposit_amount == null ? "無法計算" : `$${item.deposit_amount}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyOne(item)}
                      disabled={copyBusy || unknown || Boolean(item.error)}
                      className="min-h-11 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                    >
                      {item.error ? "無法複製" : state === "copying" ? "複製中…" : state === "copied" ? "已複製" : "單獨複製"}
                    </button>
                  </div>
                  <textarea aria-label={`${item.booking_code ?? item.date_label} 訊息內容，可手動選取`} readOnly rows={6} value={item.error ? `此筆無法產生訊息：${item.error}` : item.text} className="mt-3 w-full rounded-lg bg-gray-50 p-3 text-sm leading-6 text-gray-800" />
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
              disabled={!canBatchCopy || copyBusy || unknown}
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
