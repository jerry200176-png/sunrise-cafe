/**
 * 付款訊息判斷 / 訂位代號解析（純函式，與 webhook 共用且可測試）
 */

/** 預設付款關鍵字（可由後台 settings.payment_keywords 覆寫） */
export const DEFAULT_PAYMENT_KEYWORDS = [
  "末五碼", "五碼", "匯款", "付款", "已付", "已轉", "轉帳",
  "line pay", "linepay", "截圖", "收款", "轉過去", "付過去",
];

/** 問句用語：含這些字視為「詢問」而非付款通知，避免誤判標記已付款 */
export const QUESTION_PATTERNS = [
  "？", "?", "嗎", "呢", "如何", "怎麼", "怎樣", "多少",
  "幾點", "哪裡", "什麼時候", "要怎", "方式", "請問",
];

const BOOKING_CODE_RE = /^[A-Z0-9]{6}$/;

/**
 * 判斷一段訊息是否為付款通知。
 * 規則：先排除問句（含問號或問句用語），再比對是否命中任一付款關鍵字。
 */
export function isPaymentMessage(
  text: string,
  keywords: string[] = DEFAULT_PAYMENT_KEYWORDS
): boolean {
  const lower = text.toLowerCase();
  if (QUESTION_PATTERNS.some((q) => lower.includes(q))) return false;
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * 從客人訊息抽出 6 碼訂位代號（大寫英數）。
 * 支援純代號，以及客人貼上含 ?text=代號 / &text=代號 的網址格式。
 */
export function extractBookingCode(text: string): string | null {
  const upper = text.toUpperCase().trim();
  if (BOOKING_CODE_RE.test(upper)) return upper;
  const match = upper.match(/[?&]TEXT=([A-Z0-9]{6})(?:&|$|\s)/);
  if (match) return match[1];
  return null;
}
