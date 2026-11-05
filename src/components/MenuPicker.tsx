"use client";

import type { MenuItem } from "@/types";
import { MENU_PHOTO_NOTE, ZoomableImage } from "@/components/ZoomableImage";
import type { DraftItemInput } from "@/lib/reservation-preorder";
import { optionGroupRules } from "@/lib/option-sets";

function ruleHint(min: number, max: number | null) {
  if (min >= 1) return max === 1 ? "必選一個" : `至少選 ${min} 項`;
  return max === 1 ? "可不選" : max ? `可多選，最多 ${max} 項` : "可多選";
}

export function MenuPicker({ items, value, onChange, disabled = false, showPrices = true }: {
  items: MenuItem[];
  value: DraftItemInput[];
  onChange: (items: DraftItemInput[]) => void;
  disabled?: boolean;
  showPrices?: boolean;
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
            <div className="flex justify-between gap-3 font-medium text-stone-900"><span>{item.name}</span>{showPrices && <span>NT$ {Number(item.price).toLocaleString()}</span>}</div>
            {item.description && <p className="mt-1 text-sm text-stone-500">{item.description}</p>}
            {row && <div className="mt-3 space-y-3 border-t border-stone-100 pt-3">
              <label className="block text-sm">數量 <select aria-label={`${item.name}數量`} disabled={disabled}
                value={row.quantity} onChange={(event) => change(item.id, { quantity: Number(event.target.value) })}
                className="ml-2 w-20 rounded border border-stone-300 bg-white px-2 py-1">
                {Array.from({ length: 99 }, (_, index) => index + 1).map((amount) => <option key={amount} value={amount}>{amount}</option>)}
              </select></label>
              {optionGroupRules(item.options ?? []).map((group) => {
                const picked = (row.option_ids ?? []).filter((id) => group.optionIds.includes(id));
                const toggle = (id: string, on: boolean) => {
                  const rest = (row.option_ids ?? []).filter((x) => x !== id);
                  // 最多一項：換成新選的；多選：到上限就不再加
                  if (!on) return change(item.id, { option_ids: rest });
                  if (group.max === 1) return change(item.id, { option_ids: [...rest.filter((x) => !group.optionIds.includes(x)), id] });
                  if (group.max != null && picked.length >= group.max) return;
                  change(item.id, { option_ids: [...rest, id] });
                };
                return <fieldset key={group.key} className="text-sm"><legend className="font-medium text-stone-700">{group.label}
                  <span className={`ml-2 text-xs ${group.min >= 1 && picked.length < group.min ? "text-rose-700" : "text-stone-500"}`}>{ruleHint(group.min, group.max)}</span></legend><div className="mt-1 flex flex-wrap gap-3">
                  {(item.options ?? []).filter((option) => group.optionIds.includes(option.id)).map((option) => <label key={option.id} className="inline-flex items-center gap-1">
                    <input type={group.max === 1 ? "radio" : "checkbox"} name={`${item.id}:${group.key}`} disabled={disabled || (group.max != null && group.max > 1 && picked.length >= group.max && !picked.includes(option.id))}
                      checked={picked.includes(option.id)}
                      onClick={group.max === 1 && group.min === 0 && picked.includes(option.id) ? () => toggle(option.id, false) : undefined}
                      onChange={(event) => toggle(option.id, event.target.checked)} />
                    {option.option_name}{showPrices && Number(option.price_delta) ? ` +${option.price_delta}` : ""}
                  </label>)}
                </div></fieldset>;
              })}
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
