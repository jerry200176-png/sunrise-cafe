"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ShoppingCart, X, Plus, Minus } from "lucide-react";
import type { MenuCategory, MenuItem, CartItem, SelectedOption } from "@/types";

export default function MenuPage() {
  const { tableToken } = useParams<{ tableToken: string }>();
  const router = useRouter();

  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCat, setActiveCat] = useState<string>("all");
  const [cart, setCart] = useState<CartItem[]>([]);

  // 選項 Sheet
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const [sheetOptions, setSheetOptions] = useState<SelectedOption[]>([]);
  const [sheetQty, setSheetQty] = useState(1);
  const [sheetNotes, setSheetNotes] = useState("");

  useEffect(() => {
    // 先取桌位資訊取得 branchId
    fetch(`/api/tables/${tableToken}`)
      .then(r => r.json())
      .then(d => {
        if (d.branch_id) {
          return fetch(`/api/menu?branchId=${encodeURIComponent(d.branch_id)}`);
        }
        throw new Error("無效桌位");
      })
      .then(r => r?.json())
      .then(d => {
        if (!d) return;
        setCategories(d.categories ?? []);
        setItems(d.items ?? []);
      });
  }, [tableToken]);

  // 從 localStorage 恢復購物車
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`cart-${tableToken}`);
      if (saved) setCart(JSON.parse(saved));
    } catch { /* ignore */ }
  }, [tableToken]);

  useEffect(() => {
    localStorage.setItem(`cart-${tableToken}`, JSON.stringify(cart));
  }, [cart, tableToken]);

  const visibleItems = activeCat === "all"
    ? items.filter(i => i.is_available)
    : items.filter(i => i.is_available && i.category_id === activeCat);

  const cartTotal = cart.reduce((sum, ci) => {
    const delta = ci.selectedOptions.reduce((d, o) => d + o.delta, 0);
    return sum + (ci.menuItem.price + delta) * ci.quantity;
  }, 0);
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);

  const openSheet = (item: MenuItem) => {
    setSheetItem(item);
    // 預設每個 group 選第一個選項
    const grouped: Record<string, SelectedOption[]> = {};
    (item.options ?? []).forEach(o => {
      if (!grouped[o.option_group]) grouped[o.option_group] = [];
      grouped[o.option_group].push({ group: o.option_group, name: o.option_name, delta: o.price_delta });
    });
    setSheetOptions(Object.values(grouped).map(g => g[0]));
    setSheetQty(1);
    setSheetNotes("");
  };

  const addToCart = () => {
    if (!sheetItem) return;
    setCart(prev => {
      // 找相同餐點+選項的項目
      const key = JSON.stringify(sheetOptions);
      const idx = prev.findIndex(ci => ci.menuItem.id === sheetItem.id && JSON.stringify(ci.selectedOptions) === key);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + sheetQty };
        return updated;
      }
      return [...prev, { menuItem: sheetItem, quantity: sheetQty, selectedOptions: sheetOptions, specialNotes: sheetNotes }];
    });
    setSheetItem(null);
  };

  const setOptionChoice = (group: string, name: string, delta: number) => {
    setSheetOptions(prev => {
      const filtered = prev.filter(o => o.group !== group);
      return [...filtered, { group, name, delta }];
    });
  };

  // 按分類 groups
  const optionGroups = (item: MenuItem) => {
    const groups: Record<string, { name: string; delta: number }[]> = {};
    (item.options ?? []).forEach(o => {
      if (!groups[o.option_group]) groups[o.option_group] = [];
      groups[o.option_group].push({ name: o.option_name, delta: o.price_delta });
    });
    return groups;
  };

  return (
    <main className="min-h-screen bg-gray-50 pb-28">
      {/* 分類 Tab */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 overflow-x-auto">
        <div className="flex gap-1 px-4 py-2 min-w-max">
          <button
            type="button"
            onClick={() => setActiveCat("all")}
            className={`rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap ${activeCat === "all" ? "bg-amber-600 text-white" : "bg-gray-100 text-gray-700"}`}
          >
            全部
          </button>
          {categories.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCat(c.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap ${activeCat === c.id ? "bg-amber-600 text-white" : "bg-gray-100 text-gray-700"}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* 餐點列表 */}
      <div className="grid grid-cols-1 gap-3 p-4">
        {visibleItems.map(item => (
          <div key={item.id} className="rounded-xl bg-white border border-gray-200 overflow-hidden flex">
            {item.image_url && (
              <img src={item.image_url} alt={item.name} className="h-24 w-24 object-cover shrink-0" />
            )}
            <div className="flex flex-1 items-center justify-between p-3">
              <div>
                <p className="font-medium text-gray-900">{item.name}</p>
                {item.description && <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>}
                <p className="text-amber-700 font-bold mt-1">${item.price}</p>
              </div>
              <button
                type="button"
                onClick={() => openSheet(item)}
                className="ml-3 rounded-full bg-amber-600 h-9 w-9 flex items-center justify-center text-white shrink-0"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>
        ))}
        {visibleItems.length === 0 && (
          <p className="text-center text-gray-400 py-12">此分類尚無餐點</p>
        )}
      </div>

      {/* 浮動購物車按鈕 */}
      {cartCount > 0 && (
        <div className="fixed bottom-6 left-4 right-4 z-20">
          <button
            type="button"
            onClick={() => router.push(`/order/${tableToken}/cart`)}
            className="w-full rounded-xl bg-amber-600 py-4 text-white font-bold flex items-center justify-between px-5 shadow-xl"
          >
            <span className="bg-white/30 rounded-full px-2.5 py-0.5 text-sm">{cartCount}</span>
            <span className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" /> 查看購物車
            </span>
            <span>${cartTotal}</span>
          </button>
        </div>
      )}

      {/* 選項 Bottom Sheet */}
      {sheetItem && (
        <div className="fixed inset-0 z-30 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSheetItem(null)} />
          <div className="relative bg-white rounded-t-2xl p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-gray-900 text-lg">{sheetItem.name}</h3>
                <p className="text-amber-700 font-medium">${sheetItem.price}</p>
              </div>
              <button type="button" onClick={() => setSheetItem(null)} className="text-gray-400">
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* 選項群組 */}
            {Object.entries(optionGroups(sheetItem)).map(([group, opts]) => (
              <div key={group} className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">{group}</p>
                <div className="flex flex-wrap gap-2">
                  {opts.map(opt => {
                    const selected = sheetOptions.some(o => o.group === group && o.name === opt.name);
                    return (
                      <button
                        key={opt.name}
                        type="button"
                        onClick={() => setOptionChoice(group, opt.name, opt.delta)}
                        className={`rounded-full px-3 py-1.5 text-sm border ${selected ? "bg-amber-600 text-white border-amber-600" : "border-gray-300 text-gray-700"}`}
                      >
                        {opt.name}{opt.delta > 0 ? ` +$${opt.delta}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* 備註 */}
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-1">備註</p>
              <input
                type="text"
                value={sheetNotes}
                onChange={e => setSheetNotes(e.target.value)}
                placeholder="例：不要香菜、少辣"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            {/* 數量 + 加入 */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-3 border border-gray-200 rounded-xl px-3 py-2">
                <button type="button" onClick={() => setSheetQty(q => Math.max(1, q - 1))} className="text-gray-600">
                  <Minus className="h-5 w-5" />
                </button>
                <span className="font-bold w-6 text-center">{sheetQty}</span>
                <button type="button" onClick={() => setSheetQty(q => q + 1)} className="text-gray-600">
                  <Plus className="h-5 w-5" />
                </button>
              </div>
              <button
                type="button"
                onClick={addToCart}
                className="flex-1 rounded-xl bg-amber-600 py-3 font-bold text-white"
              >
                加入購物車
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
