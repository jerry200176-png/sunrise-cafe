"use client";

import type { MenuItem, MenuItemOption } from "@/types";
import { MENU_PHOTO_NOTE, ZoomableImage } from "@/components/ZoomableImage";
import type { DraftItemInput } from "@/lib/reservation-preorder";

function groupOptions(options: MenuItemOption[]): Record<string, MenuItemOption[]> {
  return options.reduce((groups, option) => {
    (groups[option.option_group] ??= []).push(option);
    return groups;
  }, {} as Record<string, MenuItemOption[]>);
}

export function MenuPicker({ items, value, onChange, disabled = false }: {
  items: MenuItem[];
  value: DraftItemInput[];
  onChange: (items: DraftItemInput[]) => void;
  disabled?: boolean;
}) {
  function change(id: string, patch: Partial<DraftItemInput> | null) {
    const old = value.find((row) => row.menu_item_id === id);
    onChange(patch === null ? value.filter((row) => row.menu_item_id !== id)
      : old ? value.map((row) => row.menu_item_id === id ? { ...row, ...patch } : row)
      : [...value, { menu_item_id: id, quantity: 1, option_ids: [], special_notes: "", ...patch }]);
  }
  return <div className="space-y-3">
    {items.some((item) => item.image_url) && <p className="text-xs text-stone-500">{MENU_PHOTO_NOTE}</p>}
    {items.map((item) => {
      const row = value.find((entry) => entry.menu_item_id === item.id);
      return <div key={item.id} className="rounded-xl border border-stone-200 bg-white p-3">
        <div className="flex items-start gap-3">
          <input aria-label={`選擇${item.name}`} type="checkbox" disabled={disabled} checked={Boolean(row)}
            onChange={(event) => change(item.id, event.target.checked ? {} : null)} className="mt-1 h-4 w-4 accent-amber-700" />
          {item.image_url && <ZoomableImage src={item.image_url} alt={item.name} unoptimized sizes="64px"
            className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-stone-100" />}
          <div className="min-w-0 flex-1">
            <div className="flex justify-between gap-3 font-medium text-stone-900"><span>{item.name}</span><span>NT$ {Number(item.price).toLocaleString()}</span></div>
            {item.description && <p className="mt-1 text-sm text-stone-500">{item.description}</p>}
            {row && <div className="mt-3 space-y-3 border-t border-stone-100 pt-3">
              <label className="block text-sm">數量 <select aria-label={`${item.name}數量`} disabled={disabled}
                value={row.quantity} onChange={(event) => change(item.id, { quantity: Number(event.target.value) })}
                className="ml-2 w-20 rounded border border-stone-300 bg-white px-2 py-1">
                {Array.from({ length: 99 }, (_, index) => index + 1).map((amount) => <option key={amount} value={amount}>{amount}</option>)}
              </select></label>
              {Object.entries(groupOptions(item.options ?? [])).map(([group, options]) =>
                <fieldset key={group} className="text-sm"><legend className="font-medium text-stone-700">{group}</legend><div className="mt-1 flex flex-wrap gap-3">
                  {(options ?? []).map((option) => <label key={option.id} className="inline-flex items-center gap-1">
                    <input type="checkbox" disabled={disabled} checked={(row.option_ids ?? []).includes(option.id)}
                      onChange={(event) => change(item.id, { option_ids: event.target.checked
                        ? [...(row.option_ids ?? []).filter((id) => !options?.some((choice) => choice.id === id)), option.id]
                        : (row.option_ids ?? []).filter((id) => id !== option.id) })} />
                    {option.option_name}{Number(option.price_delta) ? ` +${option.price_delta}` : ""}
                  </label>)}
                </div></fieldset>)}
              <input aria-label={`${item.name}備註`} value={row.special_notes ?? ""} maxLength={500} disabled={disabled}
                onChange={(event) => change(item.id, { special_notes: event.target.value })}
                placeholder="特殊需求（選填）" className="w-full rounded border border-stone-300 px-2 py-1.5 text-sm" />
            </div>}
          </div>
        </div>
      </div>;
    })}
  </div>;
}
