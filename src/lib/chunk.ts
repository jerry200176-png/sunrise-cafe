/**
 * 把 id 清單切成固定大小的批次。
 *
 * PostgREST 的 `.in("col", ids)` 會把每個 id 放進 URL；幾百個 UUID 就會超過閘道的 URL 長度上限
 * 而整批失敗。凡是「依清單查詢」的地方都先切批（預設 100，沿用 deposit-auto-cancelled 的做法）。
 */
export const IN_FILTER_CHUNK = 100;

export function chunk<T>(items: readonly T[], size = IN_FILTER_CHUNK): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
