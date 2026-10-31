"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { taipeiDateString } from "@/lib/datetime";

export type DepositInfo = {
  deposit_paid_on: string | null;
  deposit_last_five: string | null;
  deposit_payment_note: string | null;
};

/** 「09/28 匯款・末五碼 12345」；沒資料回空字串 */
export function transferInfoLabel(r: Partial<DepositInfo>): string {
  return [
    r.deposit_paid_on ? `${r.deposit_paid_on.slice(5).replace("-", "/")} 匯款` : null,
    r.deposit_last_five ? `末五碼 ${r.deposit_last_five}` : null,
  ]
    .filter(Boolean)
    .join("・");
}

type Method = "transfer" | "other";

type DepositPaidDialogProps = {
  title: string;
  initial?: Partial<DepositInfo>;
  onConfirm: (info: DepositInfo) => void;
  onCancel: () => void;
  reviewMessage?: string;
  onReview?: () => void;
  onRetry?: () => void;
  onMinimize?: () => void;
  minimized?: boolean;
};

export function DepositPaidDialog({ title, initial, onConfirm, onCancel, reviewMessage, onReview, onRetry, onMinimize, minimized = false }: DepositPaidDialogProps) {
  const hasOtherInfo = Boolean(initial?.deposit_payment_note) && !initial?.deposit_last_five;
  const [method, setMethod] = useState<Method>(hasOtherInfo ? "other" : "transfer");
  const [paidOn, setPaidOn] = useState(
    initial?.deposit_paid_on ?? taipeiDateString()
  );
  const [lastFive, setLastFive] = useState(initial?.deposit_last_five ?? "");
  const [note, setNote] = useState(initial?.deposit_payment_note ?? "");

  const isTransfer = method === "transfer";
  const lastFiveOk = /^\d{5}$/.test(lastFive);
  const canSubmit = isTransfer ? Boolean(paidOn) && lastFiveOk : note.trim() !== "";

  const submit = () => {
    if (!canSubmit || reviewMessage) return;
    onConfirm({
      deposit_paid_on: isTransfer ? paidOn : null,
      deposit_last_five: isTransfer ? lastFive : null,
      deposit_payment_note: note.trim() || null,
    });
  };

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-paid-dialog-title"
      style={minimized ? { display: "none" } : undefined}
      onClick={onCancel}
    >
      <form
        className="flex w-full max-w-sm flex-col rounded-t-2xl sm:rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 id="deposit-paid-dialog-title" className="text-lg font-semibold text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="-mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4 text-sm text-gray-700">
          <div className="flex gap-4" role="radiogroup" aria-label="付款方式">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={isTransfer} onChange={() => setMethod("transfer")} />
              銀行匯款
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={!isTransfer} onChange={() => setMethod("other")} />
              其他（LINE Pay／現金）
            </label>
          </div>
          {isTransfer && (
            <>
              <label className="flex flex-col gap-1">
                匯款日期
                <input
                  type="date"
                  required
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                帳號末五碼
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={5}
                  required
                  autoFocus
                  value={lastFive}
                  onChange={(e) => setLastFive(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="12345"
                  className={inputClass}
                />
              </label>
              {lastFive !== "" && !lastFiveOk && (
                <span className="-mt-2 text-xs text-red-600">請輸入 5 位數字</span>
              )}
            </>
          )}
          <label className="flex flex-col gap-1">
            {isTransfer ? "備註（選填）" : "備註（必填，例如：LINE Pay 截圖已收、現場現金）"}
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        {reviewMessage && <div role="alert" className="mx-4 mb-2 rounded bg-amber-50 p-3 text-sm text-amber-900">
          <p>{reviewMessage}</p>
          {onReview && <button type="button" onClick={onReview} className="mt-2 underline">已核對最新資料，繼續編輯</button>}
          {onRetry && <button type="button" onClick={onRetry} className="mt-2 underline">重新讀取</button>}
          {onMinimize && <button type="button" onClick={onMinimize} className="mt-2 block underline">暫時收起並核對</button>}
        </div>}
        <div className="flex gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!canSubmit || Boolean(reviewMessage)}
            className="flex-1 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            確認
          </button>
        </div>
      </form>
    </div>
  );
}
