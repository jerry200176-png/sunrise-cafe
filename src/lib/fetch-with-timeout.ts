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

/**
 * Read a response body as JSON with its own deadline. Fetch's timeout only covers
 * response headers; streaming bodies can otherwise remain pending indefinitely.
 * This helper consumes the supplied response and never retries the request.
 */
export async function readJsonWithTimeout<T>(
  response: Response,
  timeoutMs = 15000
): Promise<T> {
  const reader = response.body?.getReader();
  if (!reader) return response.json() as Promise<T>;

  const decoder = new TextDecoder();
  let text = "";
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const readBody = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as T;
  })();

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => {});
      reject(new Error("讀取資料逾時，請重試"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([readBody, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (timedOut) void reader.cancel().catch(() => {});
  }
}
