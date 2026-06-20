import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { toTaipei } from "@/lib/datetime";
import { flexHeader, flexRow, flexButtonFooter, type LineFlexContainer } from "@/lib/line-flex";
import { resolveStoreName, type BranchPaymentConfig } from "@/lib/payment-message";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const QUERY_PAGE_URL = "https://sunrise-cafe-six.vercel.app/book/query";

// 繳費通知話術已抽至 @/lib/payment-message（由分店設定驅動），此處重新匯出以維持既有 import 路徑相容
export { buildPaymentMessage } from "@/lib/payment-message";
export type { BranchPaymentConfig } from "@/lib/payment-message";

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

export async function sendLineFlexMessage(
  lineUserId: string,
  altText: string,
  contents: LineFlexContainer
): Promise<void> {
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
      messages: [{ type: "flex", altText, contents }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push 失敗：${res.status} ${body}`);
  }
}

/** 建立「訂金繳費通知」卡片（傳給客人）；匯款資訊/LINE Pay 連結由分店設定驅動 */
export function buildPaymentFlex({
  customerName,
  startTime,
  endTime,
  total,
  branch,
}: {
  customerName: string;
  startTime: string;
  endTime: string;
  total: number;
  branch: BranchPaymentConfig;
}): LineFlexContainer {
  const startDate = toTaipei(startTime);
  const endDate = toTaipei(endTime);
  const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
  const deposit = Math.ceil(total / 2);
  const storeName = resolveStoreName(branch);
  const paymentInfo = branch.payment_info?.trim();
  const linePayUrl = branch.line_pay_url?.trim();

  const bodyContents: Record<string, unknown>[] = [
    { type: "text", text: `${customerName} 您好，已收到訂位申請`, wrap: true, weight: "bold", size: "sm" },
    {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      margin: "md",
      contents: [
        flexRow("時間", `${formattedDate} ${timeRange}`),
        flexRow("總金額", `$${total}`),
        flexRow("訂金", `$${deposit}（請今日內付清）`),
      ],
    },
  ];

  if (paymentInfo) {
    bodyContents.push(
      { type: "separator", margin: "md" },
      { type: "text", text: "匯款資訊", weight: "bold", size: "sm", margin: "md" },
      ...paymentInfo.split("\n").map((line) => ({ type: "text" as const, text: line, size: "xs" as const, color: "#3D2B1F" })),
      {
        type: "text",
        text: "匯款後請回傳「末五碼」或「截圖」告知，謝謝！",
        size: "xs",
        color: "#9A8C7A",
        margin: "md",
        wrap: true,
      }
    );
  } else {
    bodyContents.push(
      { type: "separator", margin: "md" },
      {
        type: "text",
        text: "請依照官網或現場指示完成付款，並回傳證明，謝謝！",
        size: "xs",
        color: "#9A8C7A",
        margin: "md",
        wrap: true,
      }
    );
  }

  bodyContents.push({
    type: "text",
    text: "📌 帶外食沒關係，離場時請自行帶走垃圾；未帶走將酌收清潔費 300 元。",
    size: "xs",
    color: "#9A8C7A",
    wrap: true,
    margin: "sm",
  });

  return {
    type: "bubble",
    header: flexHeader("☕", storeName, "#D97706"),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: bodyContents,
    },
    footer: linePayUrl ? flexButtonFooter("用 LINE Pay 付款", linePayUrl) : undefined,
  };
}

/** 建立「訂位提醒」卡片（傳給客人，明日或 7 天前提醒共用） */
export function buildReminderFlex({
  leadLabel,
  branchName,
  roomName,
  startTime,
  endTime,
}: {
  leadLabel: string;
  branchName: string;
  roomName?: string | null;
  startTime: string;
  endTime: string;
}): LineFlexContainer {
  const startDate = toTaipei(startTime);
  const endDate = toTaipei(endTime);
  const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
  const rows = [flexRow("時間", `${formattedDate} ${timeRange}`)];
  if (roomName) rows.push(flexRow("包廂", roomName));

  return {
    type: "bubble",
    header: flexHeader("📅", `${leadLabel}訂位提醒`, "#D97706"),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "text", text: `${branchName}期待您的光臨！`, wrap: true, weight: "bold", size: "sm" },
        { type: "box", layout: "vertical", spacing: "sm", margin: "md", contents: rows },
        {
          type: "text",
          text: "如需調整請提早告知，謝謝！",
          size: "xs",
          color: "#9A8C7A",
          margin: "md",
          wrap: true,
        },
      ],
    },
    footer: flexButtonFooter("查看我的訂位", QUERY_PAGE_URL),
  };
}

// 候補通知後，客人需在此時間內點擊一鍵確認連結，逾時連結失效
export const WAITLIST_CONFIRM_WINDOW_MINUTES = 30;

/** 建立「等位空出通知」卡片（傳給客人），含一鍵確認連結 */
export function buildWaitlistFlex({
  startTime,
  endTime,
  confirmToken,
}: {
  startTime: string;
  endTime: string;
  confirmToken: string;
}): LineFlexContainer {
  const startDate = toTaipei(startTime);
  const endDate = toTaipei(endTime);
  const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
  const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
  const confirmUrl = `https://sunrise-cafe-six.vercel.app/book/waitlist/confirm?token=${confirmToken}`;

  return {
    type: "bubble",
    header: flexHeader("🎉", "等位的時段空出來了！", "#16A34A"),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        flexRow("時間", `${formattedDate} ${timeRange}`),
        {
          type: "text",
          text: `請在 ${WAITLIST_CONFIRM_WINDOW_MINUTES} 分鐘內點擊下方按鈕一鍵確認訂位，逾時將釋出給下一位候補！`,
          size: "sm",
          color: "#3D2B1F",
          wrap: true,
          margin: "md",
        },
      ],
    },
    footer: flexButtonFooter("立即確認訂位", confirmUrl, "#16A34A"),
  };
}

export function buildReviewInviteMessage({
  customerName,
  branchName,
  reviewUrl,
}: {
  customerName: string;
  branchName: string;
  reviewUrl: string;
}): string {
  const storeName = branchName.includes("大安") ? "昇昇咖啡 (大安店)" : "昇昇咖啡";
  return (
    `${customerName} 您好，感謝您今天光臨${storeName}！\n\n` +
    `若您喜歡這次的體驗，能否花 30 秒給我們一個 Google 評論？對小店真的很有幫助 🙏\n` +
    `${reviewUrl}\n\n` +
    `期待您下次再來！`
  );
}
