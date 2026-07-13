import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

/** 取得 Stripe server-side 實例（僅 Server Component / API Route 使用） */
export function getStripe(): Stripe {
  if (stripeInstance) return stripeInstance;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY environment variable");
  }
  stripeInstance = new Stripe(key, {
    apiVersion: "2025-02-24.acacia" as Stripe.LatestApiVersion,
  });
  return stripeInstance;
}
