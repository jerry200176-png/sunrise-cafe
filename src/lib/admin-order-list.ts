import type { Order, OrderItem, SelectedOption } from "@/types";
import { isValid, parseISO } from "date-fns";

/** Fields used by the order board and the print station. */
export type AdminOrderListItem = Pick<OrderItem, "id" | "item_name" | "quantity" | "special_notes"> & {
  selected_options: Array<Pick<SelectedOption, "name">> | null;
};
export type AdminOrderListRow = Pick<Order, "id" | "branch_id" | "status" | "notes" | "is_printed" | "reservation_id"> & {
  created_at: string | null;
  total_amount: number;
  table?: { number: string } | null;
  order_items?: AdminOrderListItem[] | null;
};

const ORDER_FIELDS = ["id", "branch_id", "status", "created_at", "total_amount", "notes", "is_printed", "reservation_id"] as const;
const ITEM_FIELDS = ["id", "item_name", "quantity", "special_notes"] as const;
const ORDER_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid order list data");
  return value as Record<string, unknown>;
}
function pick(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]]));
}

/** Project known fields; reject malformed nested records rather than print incomplete data. */
export function projectAdminOrderList(value: unknown): AdminOrderListRow {
  const source = object(value);
  if (typeof source.id !== "string" || !source.id || typeof source.branch_id !== "string" || !source.branch_id ||
      typeof source.status !== "string" || !["pending", "preparing", "ready", "completed", "cancelled"].includes(source.status) ||
      typeof source.is_printed !== "boolean" ||
      !(source.created_at === null || (typeof source.created_at === "string" && ORDER_TIME.test(source.created_at) && isValid(parseISO(source.created_at)))) ||
      typeof source.total_amount !== "number" || !Number.isFinite(source.total_amount) ||
      !(source.notes === null || typeof source.notes === "string") ||
      (source.reservation_id !== undefined && source.reservation_id !== null && typeof source.reservation_id !== "string")) {
    throw new Error("invalid order fields");
  }
  const result = pick(source, ORDER_FIELDS);
  if (!Object.hasOwn(source, "table") || !Object.hasOwn(source, "order_items")) throw new Error("missing order relationships");
  if (source.table === null) result.table = null;
  else {
    const table = object(source.table);
    if (typeof table.number !== "string") throw new Error("invalid table number");
    result.table = pick(table, ["number"]);
  }
  if (Object.hasOwn(source, "order_items")) {
    if (source.order_items === null) result.order_items = null;
    else {
      if (!Array.isArray(source.order_items)) throw new Error("invalid order items");
      result.order_items = source.order_items.map((value) => {
        const item = object(value);
        if (typeof item.id !== "string" || !item.id || typeof item.item_name !== "string" ||
            typeof item.quantity !== "number" || !Number.isInteger(item.quantity) ||
            !(item.special_notes === null || typeof item.special_notes === "string") ||
            !Object.hasOwn(item, "selected_options")) throw new Error("invalid order item");
        const projected = pick(item, ITEM_FIELDS);
        if (Object.hasOwn(item, "selected_options")) {
          if (item.selected_options === null) projected.selected_options = null;
          else {
            if (!Array.isArray(item.selected_options)) throw new Error("invalid order options");
            projected.selected_options = item.selected_options.map((value) => {
              const option = object(value);
              if (typeof option.name !== "string") throw new Error("invalid order option");
              return pick(option, ["name"]);
            });
          }
        }
        return projected;
      });
    }
  }
  return result as unknown as AdminOrderListRow;
}
