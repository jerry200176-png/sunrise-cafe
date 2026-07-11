/**
 * Fetch LINE message content (images) via Customer Bot token.
 * @see https://developers.line.biz/en/reference/messaging-api/#get-content
 */

const CONTENT_BASE = "https://api-data.line.me/v2/bot/message";

export async function fetchLineMessageContent(messageId: string): Promise<{
  body: ArrayBuffer;
  contentType: string;
}> {
  const token = process.env.LINE_CUSTOMER_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CUSTOMER_ACCESS_TOKEN 未設定");

  const res = await fetch(`${CONTENT_BASE}/${messageId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE content ${res.status}: ${text.slice(0, 200)}`);
  }

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const body = await res.arrayBuffer();
  return { body, contentType };
}
