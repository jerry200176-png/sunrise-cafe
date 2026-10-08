"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AdminModal } from "@/components/AdminModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MODE_LABELS, type SetMode } from "@/lib/option-sets";
import { responseError, thrownMessage } from "@/lib/friendly-error";
import type { OptionSetView } from "@/lib/option-sets-db";
import type { MenuCategory, MenuItem } from "@/types";

type Draft = {
  id?: string;
  name: string;
  mode: SetMode;
  max_pick: string;
  options: Array<{ id?: string; name: string; price_delta: string }>;
  item_ids: string[];
  category_ids: string[];
};

const blank: Draft = { name: "", mode: "optional_one", max_pick: "", options: [{ name: "", price_delta: "0" }], item_ids: [], category_ids: [] };

function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function OptionSetsPanel({
  branchId, sets, categories, items, onChanged, notify,
}: {
  branchId: string;
  sets: OptionSetView[];
  categories: MenuCategory[];
  items: MenuItem[];
  onChanged: () => void;
  notify: (message: string, variant?: "success" | "error" | "info") => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const edit = (set: OptionSetView) =>
    setDraft({
      id: set.id,
      name: set.name,
      mode: set.mode as SetMode,
      max_pick: set.max_pick ? String(set.max_pick) : "",
      options: set.options.map((o) => ({ id: o.id, name: o.name, price_delta: String(o.price_delta) })),
      item_ids: set.item_ids,
      category_ids: set.category_ids,
    });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(draft.id ? `/api/admin/menu-option-sets/${draft.id}` : "/api/admin/menu-option-sets", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch_id: branchId,
          name: draft.name,
          mode: draft.mode,
          max_pick: draft.mode === "multi" && draft.max_pick.trim() ? Number(draft.max_pick) : null,
          options: draft.options.map((o) => ({ ...(o.id ? { id: o.id } : {}), name: o.name, price_delta: Number(o.price_delta) || 0 })),
          item_ids: draft.item_ids,
          category_ids: draft.category_ids,
        }),
      });
      if (!res.ok) {
        const body = await res.clone().json().catch(() => null);
        setError(typeof body?.error === "string" && /[一-鿿]/.test(body.error) ? body.error : await responseError(res));
        return;
      }
      setDraft(null);
      notify("已儲存選項組，套用到的餐點已更新", "success");
      onChanged();
    } catch (err) {
      setError(thrownMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/menu-option-sets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await responseError(res));
      notify("已刪除選項組", "success");
      onChanged();
    } catch (err) {
      notify(`刪除失敗：${thrownMessage(err)}`, "error");
    }
  };

  const rule = (s: OptionSetView) => (s.mode === "multi" ? `可多選${s.max_pick ? `（最多 ${s.max_pick} 項）` : ""}` : MODE_LABELS[s.mode as SetMode]);

  return (
    <section aria-label="選項組" className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900">選項組</h2>
          <p className="text-xs text-gray-500">甜度、冰塊、加料這類選項，建一次就能套用到多個餐點或整個分類。</p>
        </div>
        <button type="button" onClick={() => { setError(null); setDraft({ ...blank }); }} disabled={!branchId}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-amber-600 px-3 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
          <Plus className="h-4 w-4" /> 新增選項組
        </button>
      </div>

      {sets.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">還沒有選項組。</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {sets.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">
                  {s.name} <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-normal text-amber-800">{rule(s)}</span>
                </p>
                <p className="mt-0.5 text-sm text-gray-600">
                  {s.options.map((o) => `${o.name}${o.price_delta ? `(${o.price_delta > 0 ? "+" : ""}${o.price_delta})` : ""}`).join("、")}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  套用到 {s.category_ids.length} 個分類、{s.item_ids.length} 個餐點
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button type="button" onClick={() => { setError(null); edit(s); }} aria-label={`編輯選項組 ${s.name}`}
                  className="flex h-11 w-11 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-50"><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => setRemoveId(s.id)} aria-label={`刪除選項組 ${s.name}`}
                  className="flex h-11 w-11 items-center justify-center rounded border border-red-200 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AdminModal open={draft !== null} title={draft?.id ? "編輯選項組" : "新增選項組"} onClose={() => setDraft(null)} error={error}>
        {draft && (
          <form onSubmit={save} className="space-y-4">
            <label className="block text-sm font-medium text-gray-700">
              名稱
              <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例：甜度"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
            </label>

            <fieldset>
              <legend className="text-sm font-medium text-gray-700">顧客怎麼選</legend>
              {(Object.keys(MODE_LABELS) as SetMode[]).map((m) => (
                <label key={m} className="mt-1 flex min-h-[44px] items-center gap-2 text-sm">
                  <input type="radio" name="mode" checked={draft.mode === m} onChange={() => setDraft({ ...draft, mode: m })} />
                  {MODE_LABELS[m]}
                  {m === "required_one" && <span className="text-xs text-gray-400">沒選就不能送出</span>}
                </label>
              ))}
              {draft.mode === "multi" && (
                <label className="ml-6 block text-sm">
                  最多可選
                  <input type="number" min={1} value={draft.max_pick} onChange={(e) => setDraft({ ...draft, max_pick: e.target.value })} placeholder="不限"
                    className="mx-2 w-20 rounded border border-gray-300 px-2 py-1" />項
                </label>
              )}
            </fieldset>

            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">選項</p>
                <button type="button" onClick={() => setDraft({ ...draft, options: [...draft.options, { name: "", price_delta: "0" }] })}
                  className="min-h-[44px] text-sm font-medium text-amber-800">＋ 新增選項</button>
              </div>
              {draft.options.map((o, i) => (
                <div key={o.id ?? i} className="mb-2 grid grid-cols-[1fr_5rem_auto] gap-2">
                  <input aria-label={`選項${i + 1}名稱`} placeholder="名稱，例：半糖" value={o.name}
                    onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                    className="min-w-0 rounded border border-gray-300 px-2 py-2 text-sm" />
                  <input aria-label={`選項${i + 1}加價`} type="number" placeholder="加價" value={o.price_delta}
                    onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === i ? { ...x, price_delta: e.target.value } : x)) })}
                    className="min-w-0 rounded border border-gray-300 px-2 py-2 text-sm" />
                  <button type="button" aria-label={`刪除選項${i + 1}`} onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })}
                    className="flex h-11 w-11 items-center justify-center text-rose-700">×</button>
                </div>
              ))}
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-gray-700">套用到整個分類</legend>
              <p className="text-xs text-gray-500">分類裡現在和以後新增的餐點都會有這組選項。</p>
              <div className="mt-1 flex flex-wrap gap-x-4">
                {categories.map((c) => (
                  <label key={c.id} className="flex min-h-[44px] items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={draft.category_ids.includes(c.id)} onChange={() => setDraft({ ...draft, category_ids: toggle(draft.category_ids, c.id) })} />
                    {c.name}
                  </label>
                ))}
                {categories.length === 0 && <p className="text-sm text-gray-400">還沒有分類</p>}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium text-gray-700">套用到個別餐點</legend>
              <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 px-3">
                {items.map((it) => (
                  <label key={it.id} className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input type="checkbox" checked={draft.item_ids.includes(it.id)} onChange={() => setDraft({ ...draft, item_ids: toggle(draft.item_ids, it.id) })} />
                    {it.name}
                  </label>
                ))}
                {items.length === 0 && <p className="py-2 text-sm text-gray-400">還沒有餐點</p>}
              </div>
            </fieldset>

            <div className="flex gap-2">
              <button type="button" onClick={() => setDraft(null)} className="min-h-[44px] flex-1 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">取消</button>
              <button type="submit" disabled={saving} className="min-h-[44px] flex-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60">
                {saving ? "儲存中…" : "儲存"}
              </button>
            </div>
          </form>
        )}
      </AdminModal>

      <ConfirmDialog
        open={removeId !== null}
        title="刪除選項組"
        message="刪除後，套用到的餐點會一起移除這組選項。已經送出的訂單和預點不受影響。"
        confirmLabel="刪除"
        variant="danger"
        onConfirm={() => { const id = removeId; setRemoveId(null); if (id) void remove(id); }}
        onCancel={() => setRemoveId(null)}
      />
    </section>
  );
}
