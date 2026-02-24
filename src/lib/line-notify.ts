/**
 * LINE Messaging API — Push Message 推播工具
 * 使用 LINE Official Account 的 Messaging API 將訊息推送到指定群組或用戶
 */

const LINE_API_URL = "https://api.line.me/v2/bot/message/push";

function getLineConfig() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;
  return { token, groupId };
}

/** 是否已設定 LINE 環境變數 */
export function isLineConfigured(): boolean {
  const { token, groupId } = getLineConfig();
  return Boolean(token && groupId);
}

/** 發送文字訊息到 LINE 群組 */
export async function sendLineMessage(text: string): Promise<void> {
  const { token, groupId } = getLineConfig();
  if (!token || !groupId) {
    throw new Error(
      "缺少 LINE 設定：請在 .env.local 填入 LINE_CHANNEL_ACCESS_TOKEN 和 LINE_GROUP_ID"
    );
  }

  const res = await fetch(LINE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: groupId,
      messages: [{ type: "text", text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE API 錯誤 (${res.status}): ${body}`);
  }
}

/** 格式化明日訂位提醒訊息 */
export function formatReminderMessage(
  reservations: {
    booking_code: string;
    room_name: string;
    branch_name: string;
    start_time: string;
    end_time: string;
    customer_name: string;
    phone: string;
    guest_count?: number | null;
  }[]
): string {
  if (reservations.length === 0) {
    return "📋 明日無訂位";
  }

  // 計算明天日期字串（台灣時區）
  const tomorrow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })
  );
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = `${tomorrow.getFullYear()}/${String(tomorrow.getMonth() + 1).padStart(2, "0")}/${String(tomorrow.getDate()).padStart(2, "0")}`;

  const lines = [
    `📅 明日訂位提醒（${dateStr}）`,
    `共 ${reservations.length} 筆`,
    `${"─".repeat(20)}`,
  ];

  for (const r of reservations) {
    const start = new Date(r.start_time);
    const end = new Date(r.end_time);
    const fmt = (d: Date) =>
      d.toLocaleTimeString("zh-TW", {
        timeZone: "Asia/Taipei",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

    lines.push(
      ``,
      `👤 ${r.customer_name}｜📞 ${r.phone}`,
      `🏠 ${r.branch_name} — ${r.room_name}`,
      `🕐 ${fmt(start)} ~ ${fmt(end)}`,
      ...(r.guest_count ? [`👥 ${r.guest_count} 人`] : [])
    );
  }

  return lines.join("\n");
}
