"use client";

import { useState } from "react";
import { Check, Edit2, RotateCcw, AlertCircle, MessageSquare, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toTaipei } from "@/lib/datetime";
import type { Reservation } from "@/types";
import { DepositPaidDialog, transferInfoLabel, type DepositInfo } from "@/components/admin/DepositPaidDialog";

interface DepositStatusControlProps {
  reservation: Reservation;
  isDepositRequired: boolean;
  onUpdateDepositStatus: (id: string, isPaid: boolean, info?: DepositInfo) => Promise<void>;
  onUpdateDepositInfo: (id: string, info: DepositInfo) => Promise<void>;
  onOpenConfirm?: (title: string, message: string) => Promise<boolean>;
  variant?: "desktop" | "mobile";
}

export function DepositStatusControl({
  reservation: r,
  isDepositRequired: required,
  onUpdateDepositStatus,
  onUpdateDepositInfo,
  onOpenConfirm,
  variant = "desktop",
}: DepositStatusControlProps) {
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const isPaid = Boolean(r.is_deposit_paid);
  const note = r.deposit_payment_note?.trim() || null;
  const transferInfo = transferInfoLabel(r);
  const notifiedAt = r.deposit_approved_notified_at ? toTaipei(r.deposit_approved_notified_at) : null;
  const hasPendingReviews = (r.pending_payment_reviews ?? 0) > 0;

  // 核准（未付）或修改付款資料（已付）都走同一個表單，讓店員留下對帳資訊
  const openDialog = async () => {
    if (loading) return;
    if (!isPaid && hasPendingReviews && onOpenConfirm) {
      const ok = await onOpenConfirm(
        "付款待審核提醒",
        `此訂位有 ${r.pending_payment_reviews} 筆截圖/事件待審核。\n\n建議至「付款審核」頁面核准，避免與 LINE 審核記錄脫鉤。\n\n仍要直接核准訂金？`
      );
      if (!ok) return;
    }
    setDialogOpen(true);
  };

  const handleDialogConfirm = async (info: DepositInfo) => {
    setDialogOpen(false);
    setLoading(true);
    try {
      if (isPaid) await onUpdateDepositInfo(r.id, info);
      else await onUpdateDepositStatus(r.id, true, info);
    } finally {
      setLoading(false);
    }
  };

  // 4. Reset back to unpaid
  const handleMarkUnpaid = async () => {
    if (loading) return;
    if (onOpenConfirm) {
      const ok = await onOpenConfirm(
        "改回未付訂金",
        "確定要將此訂位的訂金狀態改為「未付訂金」嗎？"
      );
      if (!ok) return;
    }

    setLoading(true);
    try {
      await onUpdateDepositStatus(r.id, false, {
        deposit_paid_on: null,
        deposit_last_five: null,
        deposit_payment_note: null,
      });
    } finally {
      setLoading(false);
    }
  };

  if (!required && !isPaid) {
    return null;
  }

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-xl border p-2 text-xs transition-colors ${
        isPaid
          ? "border-emerald-200 bg-emerald-50/50"
          : "border-amber-200 bg-amber-50/40"
      } ${variant === "mobile" ? "w-full" : ""}`}
    >
      {/* Status Header */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {isPaid ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 border border-emerald-300">
              <Check className="h-3.5 w-3.5" />
              已付訂金
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-900 border border-amber-300">
              💰 需收訂金
            </span>
          )}

          {transferInfo && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-0.5 font-medium text-stone-700 border border-stone-200"
              title="匯款資料"
            >
              🏦 {transferInfo}
            </span>
          )}

          {note && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-0.5 font-medium text-stone-700 border border-stone-200"
              title="付款備註"
            >
              📝 {note}
            </span>
          )}

          {hasPendingReviews && (
            <a
              href="/admin/payments"
              className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 font-medium text-violet-800 border border-violet-200 hover:bg-violet-200"
            >
              <AlertCircle className="h-3 w-3" />
              付款待審核 ×{r.pending_payment_reviews}
            </a>
          )}
        </div>

        {/* Side Effect Disclosure Badge */}
        <div className="text-[11px] text-stone-500">
          {isPaid ? (
            notifiedAt ? (
              <span
                className="inline-flex items-center gap-1 text-emerald-700"
                title={`LINE 平台已於 ${format(notifiedAt, "yyyy/MM/dd HH:mm", { locale: zhTW })} 接受通知`}
              >
                <MessageSquare className="h-3 w-3" />
                LINE 平台已接受（不重複）
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-stone-500">
                <MessageSquare className="h-3 w-3 text-stone-400" />
                未推播通知
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700" title="核准後將自動觸發 LINE 群組與客人通知">
              ⚡ 核准自動發 LINE 通知
            </span>
          )}
        </div>
      </div>

      {/* Structured Action Controls */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {!isPaid ? (
          <>
            <button
              type="button"
              disabled={loading}
              onClick={openDialog}
              className="inline-flex min-h-[34px] items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              核准訂金
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={loading}
              onClick={openDialog}
              className="inline-flex min-h-[30px] items-center justify-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
            >
              <Edit2 className="h-3 w-3 text-stone-500" />
              {transferInfo || note ? "修改付款資料" : "補填付款資料"}
            </button>

            {/* Reset to Unpaid */}
            <button
              type="button"
              disabled={loading}
              onClick={handleMarkUnpaid}
              className="inline-flex min-h-[30px] items-center justify-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3 text-red-500" />
              改為未付
            </button>
          </>
        )}
      </div>

      {dialogOpen && (
        <DepositPaidDialog
          title={isPaid ? "修改付款資料" : "核准訂金"}
          initial={{
            deposit_paid_on: r.deposit_paid_on,
            deposit_last_five: r.deposit_last_five,
            deposit_payment_note: note,
          }}
          onConfirm={handleDialogConfirm}
          onCancel={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
