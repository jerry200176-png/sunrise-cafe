/**
 * 新台幣（整數元）↔ Stripe amount 的唯一換算點。
 * Stripe 把 TWD 當兩位小數幣別：NT$500 要送 50000（而且必須是 100 的倍數）。
 * 我們的資料庫、帳本、畫面一律用整數元；只有呼叫 Stripe／讀 Stripe 回來的數字時才換算。
 */
export const STRIPE_CURRENCY = "twd";

/** Stripe 的零小數幣別（amount 就是整數單位）。TWD 不在其中。 */
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

const factor = (currency: string) => (ZERO_DECIMAL.has(currency.toLowerCase()) ? 1 : 100);

/** 整數元 → Stripe amount（TWD ×100）。非正整數元直接丟錯，避免把小數或負數送給 Stripe。 */
export function toStripeAmount(dollars: number, currency: string = STRIPE_CURRENCY): number {
  if (!Number.isInteger(dollars) || dollars < 0) throw new Error(`invalid amount: ${dollars}`);
  return dollars * factor(currency);
}

/** Stripe amount → 整數元（TWD ÷100，無條件捨去：寧可少算可退金額，也不多算） */
export function fromStripeAmount(amount: number, currency: string = STRIPE_CURRENCY): number {
  return Math.floor((Number(amount) || 0) / factor(currency));
}
