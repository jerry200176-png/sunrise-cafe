import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_PAY_URL =
  "https://qrcodepay.line.me/qr/payment/%252BmF6rR41PSp3R8NMydLA%252BRt1IvAFgPchBvtrJoR20aoZKY4Hr1qrbfaYSoPDUyu0";

export async function sendLineMessage(lineUserId: string, text: string): Promise<void> {
  const token = process.env.LINE_CUSTOMER_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CUSTOMER_ACCESS_TOKEN 未設定");

  const res = await fetch(PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push 失敗：${res.status} ${body}`);
  }
}

export function buildPaymentMessage({
  customerName,
  startTime,
  endTime,
  total,
  branchName,
}: {
  customerName: string;
  startTime: string;
  endTime: string;
  total: number;
  branchName: string;
}): string {
  const startDate = parseISO(startTime);
  const endDate = parseISO(endTime);
  const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
  const deposit = Math.ceil(total / 2);
  const storeName = branchName.includes("大安") ? "昇昇咖啡 (大安店)" : "昇昇咖啡";

  return (
    `您好，這裡是${storeName}。\n\n` +
    `收到您 ${formattedDate} ${timeRange} 的預約申請（${customerName}）。\n` +
    `確認該時段有空位，本筆訂單總金額為 $${total}，請於今日內匯款訂金 $${deposit}（總額一半）以保留座位。\n\n` +
    `【匯款資訊】\n銀行：台北富邦銀行 (012)\n帳號：8212-00000-8489-6\n戶名：昇昇咖啡張文霞\n\n` +
    `或者您可以使用 LINE Pay 付款：\n${LINE_PAY_URL}\n\n` +
    `匯款後請回傳「末五碼」或「截圖」告知，謝謝！\n\n` +
    `📌 帶外食沒關係，離場時請將垃圾自行帶走；若未帶走，將酌收清潔費 300 元。`
  );
}
