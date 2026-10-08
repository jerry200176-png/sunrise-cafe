/** 後台所有頁面共用的狀態中文名稱（只做顯示，不影響資料）。 */
const RESERVATION_STATUS: Record<string, string> = {
  pending: "待確認",
  confirmed: "已確認",
  checked_in: "已到店",
  completed: "已完成",
  paid: "已完成",
  cancelled: "已取消",
  no_show: "未到店",
};

export function reservationStatusLabel(status: string | null | undefined): string {
  return (status && RESERVATION_STATUS[status]) || "其他";
}

const PREORDER_STATUS: Record<string, string> = {
  draft: "客人尚未送出",
  submitted: "已送出",
};

export function preorderStatusLabel(status: string | null | undefined): string {
  return (status && PREORDER_STATUS[status.toLowerCase()]) || "其他";
}

export function waitlistStatusLabel(status: string | null | undefined): string {
  if (status === "waiting") return "等候中";
  if (status === "notified") return "已通知";
  return "其他";
}

export function paymentSourceLabel(source: string | null | undefined): string {
  if (source === "bank_transfer") return "銀行轉帳回報";
  if (source === "line_image") return "LINE 截圖";
  if (source === "line_text") return "LINE 文字";
  return "其他來源";
}
