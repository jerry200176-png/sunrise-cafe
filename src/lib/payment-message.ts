/**
 * 繳費通知話術產生器（純函式，後台複製按鈕與伺服器推播共用）
 *
 * 店名、匯款資訊、LINE Pay 連結皆由分店設定（branches 表）驅動，
 * 不再於程式內硬編碼任何分店資訊。未設定時以通用話術降級。
 */
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toTaipei } from "@/lib/datetime";

export interface BranchPaymentConfig {
  name?: string | null;
  display_name?: string | null;
  payment_info?: string | null;
  line_pay_url?: string | null;
}

/** 解析對客顯示店名：優先 display_name，否則由分店名稱推導，最後通用 */
export function resolveStoreName(branch: BranchPaymentConfig): string {
  const display = branch.display_name?.trim();
  if (display) return display;
  const name = branch.name?.trim();
  return name ? `昇昇咖啡 (${name})` : "昇昇咖啡";
}

export function buildPaymentMessage(opts: {
  customerName: string;
  startTime: string;
  endTime: string;
  total: number;
  branch: BranchPaymentConfig;
  /** 訂位代號；有則引導客人回傳「訂位碼 + 末五碼」便於對帳 */
  bookingCode?: string | null;
}): string {
  const { customerName, startTime, endTime, total, branch, bookingCode } = opts;
  const startDate = toTaipei(startTime);
  const endDate = toTaipei(endTime);
  const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
  const deposit = Math.ceil(total / 2);
  const storeName = resolveStoreName(branch);
  const code = bookingCode?.trim();

  const paymentInfo = branch.payment_info?.trim();
  const linePayUrl = branch.line_pay_url?.trim();
  const hasPaymentDetails = Boolean(paymentInfo || linePayUrl);

  const lines: string[] = [
    `您好，這裡是${storeName}。`,
    ``,
    `收到您 ${formattedDate} ${timeRange} 的預約申請（${customerName}）。`,
    `確認該時段有空位，本筆訂單總金額為 $${total}，請於今日內匯款訂金 $${deposit}（總額一半）以保留座位。`,
    ``,
  ];

  if (code) {
    lines.push(`您的訂位碼：${code}`, ``);
  }

  if (hasPaymentDetails) {
    if (paymentInfo) lines.push(paymentInfo, ``);
    if (linePayUrl) lines.push(`或者您可以使用 LINE Pay 付款：`, linePayUrl, ``);
    if (code) {
      lines.push(
        `匯款後請回傳一行文字（範例）：`,
        `${code} 12345`,
        `（訂位碼 + 匯款帳號末五碼；亦可附上截圖）`,
        ``
      );
    } else {
      lines.push(`匯款後請回傳「訂位碼」與「末五碼」（可附截圖），謝謝！`, ``);
    }
  } else {
    lines.push(
      code
        ? `請依照官網或現場指示完成付款，並回傳「${code}」與末五碼證明，謝謝！`
        : `請依照官網或現場指示完成付款，並回傳訂位碼與證明，謝謝！`,
      ``
    );
  }

  lines.push(
    `📌 帶外食沒關係，離場時請將垃圾自行帶走；若未帶走，將酌收清潔費 300 元。`
  );

  return lines.join("\n");
}
