import type { Order, OrderItem, SelectedOption } from "@/types";

/** Fields used by the order board and the print station. */
export type AdminOrderListItem = Pick<OrderItem, "id" | "item_name" | "quantity" | "special_notes"> & {
  selected_options: Array<Pick<SelectedOption, "name">> | null;
};
export type AdminOrderListRow = Pick<Order, "id" | "branch_id" | "status" | "created_at" | "total_amount" | "notes" | "is_printed" | "reservation_id"> & {
  table?: { number: string } | null;
  order_items?: AdminOrderListItem[] | null;
};

const ORDER_FIELDS = ["id", "branch_id", "status", "created_at", "total_amount", "notes", "is_printed", "reservation_id"] as const;
const ITEM_FIELDS = ["id", "item_name", "quantity", "special_notes"] as const;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid order list data");
  return value as Record<string, unknown>;
}
function pick(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]]));
}

/** Project known fields; reject malformed nested records rather than print incomplete data. */
export function projectAdminOrderList(value: unknown): Record<string, unknown> {
  const source = object(value);
  const result = pick(source, ORDER_FIELDS);
  if (Object.hasOwn(source, "table")) result.table = source.table == null ? source.table : pick(object(source.table), ["number"]);
  if (Object.hasOwn(source, "order_items")) {
    if (source.order_items == null) result.order_items = source.order_items;
    else {
      if (!Array.isArray(source.order_items)) throw new Error("invalid order items");
      result.order_items = source.order_items.map((value) => {
        const item = object(value);
        if (typeof item.id !== "string" || typeof item.item_name !== "string" || typeof item.quantity !== "number" || !Number.isFinite(item.quantity)) throw new Error("invalid order item");
        const projected = pick(item, ITEM_FIELDS);
        if (Object.hasOwn(item, "selected_options")) {
          if (item.selected_options == null) projected.selected_options = item.selected_options;
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
  return result;
}
