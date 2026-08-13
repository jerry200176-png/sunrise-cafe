/**
 * LINE Pay Online API v4 server client.
 *
 * Keep Channel Secret server-side. The request/confirm routes are the only
 * callers; this module must never be imported by client components.
 */
import { createHmac, randomUUID } from "node:crypto";

const DEFAULT_API_BASE_URL = "https://api-pay.line.me";
const CHANNEL_ID_ENV = "LINE_PAY_CHANNEL_ID";
const CHANNEL_SECRET_ENV = "LINE_PAY_CHANNEL_SECRET";

export type LinePayApiResponse = {
  returnCode?: string;
  returnMessage?: string;
  info?: Record<string, unknown>;
};

export type LinePayRequestStatusCode = "0000" | "0110" | "0121" | "0122" | "0123";

export type LinePayPaymentRequest = {
  amount: number;
  currency: "TWD";
  orderId: string;
  packages: Array<{
    id: string;
    amount: number;
    products: Array<{ name: string; quantity: number; price: number }>;
  }>;
  redirectUrls: { confirmUrl: string; cancelUrl: string };
};

export function isLinePayConfigured(): boolean {
  return Boolean(
    process.env[CHANNEL_ID_ENV]?.trim() && process.env[CHANNEL_SECRET_ENV]?.trim()
  );
}

export function getLinePayApiBaseUrl(): string {
  return process.env.LINE_PAY_API_BASE_URL?.trim().replace(/\/$/, "") || DEFAULT_API_BASE_URL;
}

/** LINE Pay requires the exact compact JSON body in its HMAC message. */
export function createLinePaySignature(
  channelSecret: string,
  apiPath: string,
  body: string,
  nonce: string
): string {
  return createHmac("sha256", channelSecret)
    .update(`${channelSecret}${apiPath}${body}${nonce}`)
    .digest("base64");
}

/** LINE Pay transaction IDs can exceed JavaScript's safe integer range. */
export function parseLinePayJson<T>(text: string): T {
  const safeJson = text.replace(/([:\[,\s])(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"');
  return JSON.parse(safeJson) as T;
}

function requiredCredentials(): { channelId: string; channelSecret: string } {
  const channelId = process.env[CHANNEL_ID_ENV]?.trim();
  const channelSecret = process.env[CHANNEL_SECRET_ENV]?.trim();
  if (!channelId || !channelSecret) {
    throw new Error("LINE Pay 尚未設定商戶 Channel ID / Channel Secret");
  }
  return { channelId, channelSecret };
}

async function callLinePayApi(
  apiPath: string,
  body: Record<string, unknown>,
  method: "GET" | "POST" = "POST",
  acceptedReturnCodes: string[] = ["0000"]
): Promise<LinePayApiResponse> {
  const { channelId, channelSecret } = requiredCredentials();
  const nonce = randomUUID();
  const bodyText = method === "GET" ? "" : JSON.stringify(body);
  const authorization = createLinePaySignature(channelSecret, apiPath, bodyText, nonce);
  const response = await fetch(`${getLinePayApiBaseUrl()}${apiPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-LINE-ChannelId": channelId,
      "X-LINE-Authorization": authorization,
      "X-LINE-Authorization-Nonce": nonce,
    },
    ...(method === "POST" ? { body: bodyText } : {}),
    cache: "no-store",
  });
  const responseText = await response.text();
  let payload: LinePayApiResponse;
  try {
    payload = parseLinePayJson<LinePayApiResponse>(responseText);
  } catch {
    throw new Error(`LINE Pay 回應格式錯誤 (${response.status})`);
  }

  if (!response.ok || !acceptedReturnCodes.includes(payload.returnCode ?? "")) {
    const code = payload.returnCode || String(response.status);
    const message = payload.returnMessage || "LINE Pay API 拒絕請求";
    throw new Error(`LINE Pay API 失敗 (${code}): ${message}`);
  }
  return payload;
}

export async function requestLinePayPayment(
  request: LinePayPaymentRequest
): Promise<LinePayApiResponse> {
  return callLinePayApi("/v4/payments/request", request as unknown as Record<string, unknown>);
}

export async function confirmLinePayPayment(
  transactionId: string,
  amount: number,
  currency: "TWD" = "TWD"
): Promise<LinePayApiResponse> {
  return callLinePayApi(`/v4/payments/${encodeURIComponent(transactionId)}/confirm`, {
    amount,
    currency,
  });
}

/** Check whether the customer finished the LINE Pay payment request. */
export async function checkLinePayPaymentRequestStatus(
  transactionId: string
): Promise<LinePayApiResponse> {
  return callLinePayApi(
    `/v4/payments/requests/${encodeURIComponent(transactionId)}/check`,
    {},
    "GET",
    ["0000", "0110", "0121", "0122", "0123"]
  );
}

/** Read provider details after a timeout or redirect interruption. */
export async function retrieveLinePayPaymentDetails(options: {
  orderId?: string;
  transactionId?: string;
}): Promise<LinePayApiResponse> {
  const query = new URLSearchParams();
  if (options.orderId) query.append("orderId[]", options.orderId);
  if (options.transactionId) query.append("transactionId[]", options.transactionId);
  const suffix = query.toString();
  return callLinePayApi(`/v4/payments${suffix ? `?${suffix}` : ""}`, {}, "GET");
}
