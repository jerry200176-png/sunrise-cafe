/**
 * 桌邊 QR 點餐（/api/orders）的伺服器端定價 — 純函式（#434）。
 *
 * 客人送來的購物車只當作「點了什麼」：餐點 id、數量、選項（組名＋名稱）與備註。
 * 單價、選項加價、餐點名稱與小計一律以這間分店的 menu_items / menu_item_options 為準，
 * 客人改過的 price / delta / name 全部忽略。
 */
import { checkOptionSelection, type RuleOption } from "@/lib/option-sets";

export const MAX_ORDER_LINES = 50;
export const MAX_LINE_QUANTITY = 99;
const MAX_NOTE_LENGTH = 200;

export type CatalogOption = RuleOption & { option_name: string; price_delta: number | string | null };

export type CatalogRow = {
  id: string;
  name: string;
  price: number | string;
  is_available: boolean;
  options: CatalogOption[] | null;
};

export type PricedLine = {
  menu_item_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  selected_options: Array<{ group: string; name: string; delta: number }> | null;
  special_notes: string | null;
};

export type ParsedLine = {
  menuItemId: string;
  quantity: number;
  options: Array<{ group: string; name: string }>;
  specialNotes: string | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 只取出點餐需要的欄位；格式不對（含不合理的數量）就回 400 用的中文錯誤。 */
export function parseOrderLines(raw: unknown): Result<ParsedLine[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "購物車是空的" };
  if (raw.length > MAX_ORDER_LINES) return { ok: false, error: `一次最多點 ${MAX_ORDER_LINES} 項` };
  const lines: ParsedLine[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || !isRecord(entry.menuItem)) return { ok: false, error: "訂單資料格式不正確" };
    const menuItemId = entry.menuItem.id;
    if (typeof menuItemId !== "string" || menuItemId.length === 0 || menuItemId.length > 64) {
      return { ok: false, error: "訂單資料格式不正確" };
    }
    const quantity = entry.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
      return { ok: false, error: `每項數量需為 1 到 ${MAX_LINE_QUANTITY} 的整數` };
    }
    const rawOptions = entry.selectedOptions ?? [];
    if (!Array.isArray(rawOptions)) return { ok: false, error: "餐點選項格式不正確" };
    const options: ParsedLine["options"] = [];
    for (const option of rawOptions) {
      if (!isRecord(option) || typeof option.group !== "string" || typeof option.name !== "string") {
        return { ok: false, error: "餐點選項格式不正確" };
      }
      options.push({ group: option.group, name: option.name });
    }
    const notes = typeof entry.specialNotes === "string" ? entry.specialNotes.trim().slice(0, MAX_NOTE_LENGTH) : "";
    lines.push({ menuItemId, quantity, options, specialNotes: notes || null });
  }
  return { ok: true, value: lines };
}

/**
 * 依菜單重新算每一行的單價與總金額。
 * catalog 必須已限定為「這張桌子所屬分店」的餐點；找不到、已停售、選項對不上都拒絕。
 */
export function priceOrderLines(lines: ParsedLine[], catalog: CatalogRow[]): Result<{ lines: PricedLine[]; total: number }> {
  const byId = new Map(catalog.map((row) => [row.id, row]));
  const priced: PricedLine[] = [];
  let total = 0;
  for (const line of lines) {
    const row = byId.get(line.menuItemId);
    if (!row || !row.is_available) return { ok: false, error: "部分餐點目前無法點餐" };
    const basePrice = Number(row.price);
    if (!Number.isFinite(basePrice) || basePrice < 0) return { ok: false, error: "部分餐點目前無法點餐" };
    const catalogOptions = row.options ?? [];
    const picked = line.options.map((choice) =>
      catalogOptions.find((option) => option.option_group === choice.group && option.option_name === choice.name)
    );
    if (picked.some((option) => !option)) return { ok: false, error: `${row.name}：餐點選項已變更，請重新選擇` };
    const chosen = picked as CatalogOption[];
    const problem = checkOptionSelection(catalogOptions, chosen.map((option) => option.id));
    if (problem) return { ok: false, error: `${row.name}：${problem}` };
    const selected = chosen.map((option) => ({
      group: option.option_group ?? "",
      name: option.option_name,
      delta: Number(option.price_delta ?? 0),
    }));
    if (selected.some((option) => !Number.isFinite(option.delta))) return { ok: false, error: "部分餐點目前無法點餐" };
    const unitPrice = basePrice + selected.reduce((sum, option) => sum + option.delta, 0);
    if (unitPrice < 0) return { ok: false, error: `${row.name}：價格設定有誤，請洽店員` };
    total += unitPrice * line.quantity;
    priced.push({
      menu_item_id: row.id,
      item_name: row.name,
      quantity: line.quantity,
      unit_price: unitPrice,
      selected_options: selected.length > 0 ? selected : null,
      special_notes: line.specialNotes,
    });
  }
  return { ok: true, value: { lines: priced, total } };
}
