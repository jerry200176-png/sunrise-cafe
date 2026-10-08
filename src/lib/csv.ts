/** 一格 CSV：含逗號、引號、換行時加雙引號；開頭是 = + - @ 時加單引號，避免 Excel 當公式執行。 */
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(",");
