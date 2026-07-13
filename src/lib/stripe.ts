import Stripe from "stripe";

/**
 * Stripe 伺服端實例（API routes / webhook handler 使用）。
 * 僅在 STRIPE_SECRET_KEY 存在時初始化，避免 dev 環境無設定時 crash。
 */
function createStripeInstance(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.warn("[stripe] STRIPE_SECRET_KEY 未設定，Stripe 功能已停用");
    return null;
  }
  return new Stripe(key, {
    apiVersion: "2025-02-24.acacia",
  });
}

export const stripe = createStripeInstance();

/** 檢查 Stripe 是否已啟用 */
export function isStripeEnabled(): boolean {
  return stripe !== null && Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}
