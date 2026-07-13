"use client";

import { useState } from "react";
import {
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Loader2, Lock } from "lucide-react";

interface PaymentFormProps {
  amount: number;
  onSuccess: (paymentIntentId: string) => void;
  onError: (message: string) => void;
  onCancel?: () => void;
}

export function PaymentForm({
  amount,
  onSuccess,
  onError,
  onCancel,
}: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      setErrorMsg("付款系統尚未就緒，請稍後再試");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      });

      if (error) {
        setErrorMsg(error.message ?? "付款失敗，請再試一次");
        onError(error.message ?? "付款失敗，請再試一次");
      } else if (paymentIntent?.status === "succeeded") {
        onSuccess(paymentIntent.id);
      } else {
        const statusText =
          paymentIntent?.status === "requires_payment_method"
            ? "付款未完成，請檢查卡片資料"
            : paymentIntent?.status === "processing"
              ? "付款處理中，請稍候"
              : `付款狀態: ${paymentIntent?.status ?? "未知"}`;
        setErrorMsg(statusText);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "付款時發生錯誤";
      setErrorMsg(msg);
      onError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/* 金額摘要 */}
      <div className="rounded-lg border border-ink/10 bg-paper-deep px-4 py-3 text-center">
        <p className="text-xs text-ink-faint">訂金金額</p>
        <p className="mt-0.5 font-display text-2xl font-semibold text-ink tabular-nums">
          NT$ {amount.toLocaleString()}
        </p>
      </div>

      {/* Stripe Payment Element */}
      <div className="rounded-lg border border-ink/10 bg-white px-3 py-2">
        <PaymentElement
          options={{
            layout: "tabs" as const,
            defaultValues: {
              billingDetails: {
                // Stripe 會根據卡片自動帶入
              },
            },
          }}
        />
      </div>

      {/* 錯誤訊息 */}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errorMsg}
        </div>
      )}

      {/* 安全提示 */}
      <div className="flex items-center justify-center gap-1.5 text-xs text-ink-faint">
        <Lock className="h-3 w-3" />
        <span>安全加密支付 · PCI-DSS 認證</span>
      </div>

      {/* 按鈕列 */}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="submit"
          disabled={!stripe || !elements || submitting}
          className="flex flex-1 items-center justify-center gap-2 rounded-[1.4rem] bg-gradient-to-br from-caramel to-caramel-deep px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(157,101,25,0.45)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              處理中…
            </>
          ) : (
            `支付 NT$ ${amount.toLocaleString()}`
          )}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-[1.4rem] border border-ink/10 bg-white/70 px-6 py-3 text-sm font-medium text-ink-soft backdrop-blur-sm transition hover:border-caramel disabled:opacity-50"
          >
            稍後再付
          </button>
        )}
      </div>
    </form>
  );
}
