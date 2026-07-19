/**
 * 包裝 fetch，加入 AbortController timeout 保護。
 * 用於所有 client-side data fetch，避免請求卡住無回應。
 *
 * @param input   fetch 的第一個參數（URL string / URL / Request）
 * @param init    fetch 選項（不含 signal）
 * @param timeoutMs  逾時毫秒，預設 15000（15 秒）
 * @returns       Promise<Response>，與原生 fetch 同介面
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init?: RequestInit,
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}
