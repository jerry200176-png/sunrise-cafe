"use client";

import { useEffect, useState, useCallback } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { X, CreditCard, Loader2, CheckCircle2 } from "lucide-react";
import { PaymentForm } from "./PaymentForm";

let stripePromise: Promise<Stripe | null> | null = null;

function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      console.error("Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
      return Promise.resolve(null);
    }
    stripePromise = loadStripe(key);
  }
  return stripePromise;
}

interface PaymentModalProps {
  open: boolean;
  reservationId: string;
  branchId: string;
  amount: number;
  onClose: () => void;
  onPaymentComplete: (paymentIntentId: string) => void;
}

type ModalState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; clientSecret: string }
  | { phase: "processing" }
  | { phase: "succeeded" };

export function PaymentModal({
  open,
  reservationId,
  branchId,
  amount,
  onClose,
  onPaymentComplete,
}: PaymentModalProps) {
  const [state, setState] = useState<ModalState>({ phase: "loading" });
  const [confirming, setConfirming] = useState(false);

  // 建立 PaymentIntent（含 timeout 保護）
  const createIntent = useCallback(async () => {
    if (!open) return;
    setState({ phase: "loading" });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000); // 15 秒 timeout

    try {
      const res = await fetch("/api/payment/create-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId, branchId, amount }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await res.json();

      if (!res.ok || !data.clientSecret) {
        setState({ phase: "error", message: data.error ?? "無法建立付款" });
        return;
      }

      setState({ phase: "ready", clientSecret: data.clientSecret });
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err instanceof DOMException && err.name === "AbortError";
      setState({
        phase: "error",
        message: isTimeout
          ? "付款連線逾時，請檢查網路後重試"
          : err instanceof Error
          ? err.message
          : "無法建立付款連線",
      });
    }
  }, [open, reservationId, branchId, amount]);

  useEffect(() => {
    createIntent();
  }, [createIntent]);

  // 付款成功 → 呼叫 confirm-deposit（含 timeout 保護）
  const handlePaymentSuccess = useCallback(
    async (paymentIntentId: string) => {
      setConfirming(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000); // 20 秒 timeout

      try {
        const res = await fetch("/api/payment/confirm-deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentIntentId, reservationId }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const data = await res.json();

        if (res.ok && data.depositStatus === "paid") {
          setState({ phase: "succeeded" });
          onPaymentComplete(paymentIntentId);
        } else {
          setState({
            phase: "error",
            message: data.error ?? "付款確認失敗，請聯絡店家",
          });
        }
      } catch (err) {
        clearTimeout(timeoutId);
        const isTimeout = err instanceof DOMException && err.name === "AbortError";
        setState({
          phase: "error",
          message: isTimeout
            ? "付款確認逾時，您的付款可能已成功，請勿重複付款"
            : err instanceof Error
            ? err.message
            : "付款確認失敗",
        });
      } finally {
        setConfirming(false);
      }
    },
    [reservationId, onPaymentComplete]
  );

  const handlePaymentError = useCallback((message: string) => {
    setState({ phase: "error", message });
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="線上支付訂金"
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-ink/35 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 flex w-full max-w-md flex-col rounded-t-2xl bg-white shadow-[0_8px_32px_rgba(44,24,16,0.14)] sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-latte px-5 py-4">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-caramel" />
            <h2 className="font-serif text-lg font-semibold text-ink">
              支付訂金
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="rounded-lg p-1.5 text-ink-faint transition hover:bg-paper hover:text-ink"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-5">
          {state.phase === "loading" && (
            <div className="flex flex-col items-center gap-3 py-12 text-ink-faint">
              <Loader2 className="h-8 w-8 animate-spin text-caramel" />
              <p className="text-sm">建立安全付款連線中…</p>
            </div>
          )}

          {state.phase === "error" && (
            <div className="space-y-4 py-6 text-center">
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {state.message}
              </div>
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={createIntent}
                  className="rounded-[1.4rem] bg-gradient-to-br from-caramel to-caramel-deep px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(157,101,25,0.45)] transition hover:-translate-y-0.5"
                >
                  重試
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-[1.4rem] border border-ink/10 bg-white/70 px-5 py-2.5 text-sm font-medium text-ink-soft backdrop-blur-sm"
                >
                  關閉
                </button>
              </div>
            </div>
          )}

          {state.phase === "ready" && (
            <Elements
              stripe={getStripePromise()}
              options={{
                clientSecret: state.clientSecret,
                appearance: {
                  theme: "stripe",
                  variables: {
                    colorPrimary: "#9d6519",
                    colorDanger: "#C44D34",
                    borderRadius: "8px",
                    fontFamily: "Noto Sans TC, system-ui, sans-serif",
                  },
                },
              }}
            >
              <PaymentForm
                amount={amount}
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
                onCancel={onClose}
              />
            </Elements>
          )}

          {state.phase === "succeeded" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <h3 className="font-serif text-lg font-semibold text-ink">
                支付完成！
              </h3>
              <p className="text-sm text-ink-soft">
                訂金 NT$ {amount.toLocaleString()} 已付款成功 ☀️
              </p>
            </div>
          )}

          {confirming && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-ink-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              確認付款中…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
