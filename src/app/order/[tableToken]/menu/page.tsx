"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ShoppingCart, X, Plus, Minus } from "lucide-react";
import type { MenuCategory, MenuItem, CartItem, SelectedOption } from "@/types";
import { checkOptionSelection, optionGroupRules } from "@/lib/option-sets";
import { BranchMenuBanner, MENU_PHOTO_NOTE, ZoomableImage } from "@/components/ZoomableImage";
import { qrHoldEntries, qrHoldKey, qrIsHoldKey } from "@/lib/qr-order-local-hold";

export default function MenuPage() {
  const { tableToken } = useParams<{ tableToken: string }>();
  const router = useRouter();

  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCat, setActiveCat] = useState<string>("all");
  const [branchName, setBranchName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hold, setHold] = useState(true);
  const [holdReady, setHoldReady] = useState(false);
  const [loadedToken, setLoadedToken] = useState("");
  const holdKey = qrHoldKey(tableToken);
  const cartKey = `cart-${tableToken}`;
  const currentHoldReady = holdReady && loadedToken === tableToken;

  // 選項 Sheet
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const [sheetOptions, setSheetOptions] = useState<SelectedOption[]>([]);
  const [sheetQty, setSheetQty] = useState(1);
  const [sheetNotes, setSheetNotes] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(""); setItems([]); setCategories([]);
    // 先取桌位資訊取得 branchId
    fetch(`/api/tables/${tableToken}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "無法載入桌位");
        return data;
      })
      .then(d => {
        if (d.branch_id) {
          if (active) setBranchName(d.branches?.name ?? null);
          return fetch(`/api/menu?branchId=${encodeURIComponent(d.branch_id)}`);
        }
        throw new Error("無效桌位");
      })
      .then(async (r) => { if (!r?.ok) throw new Error("目前無法載入菜單，請稍後再試"); return r.json(); })
      .then(d => {
        if (!active || !d) return;
        setCategories(d.categories ?? []);
        setItems(d.items ?? []);
      })
      .catch((cause) => { if (active) setLoadError(cause instanceof Error ? cause.message : "目前無法載入菜單，請稍後再試"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tableToken]);

  // 從 localStorage 恢復購物車
  useEffect(() => {
    setHoldReady(false);
    try {
      const saved = localStorage.getItem(cartKey);
      const restored = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(restored)) throw new Error("invalid cart");
      setCart(restored);
      setHold(qrHoldEntries(tableToken).length > 0);
    } catch { setHold(true); }
    setLoadedToken(tableToken);
    setHoldReady(true);
    const onStorage = (event: StorageEvent) => {
      if (qrIsHoldKey(tableToken, event.key)) {
        try { setHold(qrHoldEntries(tableToken).length > 0); } catch { setHold(true); }
      }
      if (event.key === cartKey || event.key === null) {
        try { const saved = localStorage.getItem(cartKey); const restored = saved ? JSON.parse(saved) : []; if (!Array.isArray(restored)) throw new Error("invalid cart"); setCart(restored); } catch { setHold(true); }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [tableToken, holdKey, cartKey]);

  const visibleItems = activeCat === "all"
    ? items.filter(i => i.is_available)
    : items.filter(i => i.is_available && i.category_id === activeCat);

  const cartTotal = cart.reduce((sum, ci) => {
    const delta = ci.selectedOptions.reduce((d, o) => d + o.delta, 0);
    return sum + (ci.menuItem.price + delta) * ci.quantity;
  }, 0);
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);

  const openSheet = (item: MenuItem) => {
    if (hold || !currentHoldReady) return;
    setSheetItem(item);
    setSheetOptions([]); // 必選的由顧客自己選，不預設
    setSheetQty(1);
    setSheetNotes("");
  };

  const addToCart = () => {
    if (!sheetItem || hold || !currentHoldReady) return;
    try {
      if (qrHoldEntries(tableToken).length) { setHold(true); setSheetItem(null); return; }
      const saved = localStorage.getItem(cartKey);
      const prev: CartItem[] = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(prev)) throw new Error("invalid cart");
      const key = JSON.stringify(sheetOptions);
      const idx = prev.findIndex(ci => ci.menuItem.id === sheetItem.id && JSON.stringify(ci.selectedOptions) === key);
      let updated: CartItem[];
      if (idx >= 0) {
        updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + sheetQty };
      } else {
        updated = [...prev, { menuItem: sheetItem, quantity: sheetQty, selectedOptions: sheetOptions, specialNotes: sheetNotes }];
      }
      if (qrHoldEntries(tableToken).length) { setHold(true); setSheetItem(null); return; }
      localStorage.setItem(cartKey, JSON.stringify(updated));
      setCart(updated);
    } catch { setHold(true); setSheetItem(null); return; }
    setSheetItem(null);
  };

  const toggleOption = (item: MenuItem, groupKey: string, name: string, delta: number) => {
    const group = optionGroupRules(item.options ?? []).find((g) => g.key === groupKey);
    if (!group) return;
    const label = group.label;
    const inGroup = (o: SelectedOption) => o.group === label;
    setSheetOptions((prev) => {
      if (prev.some((o) => inGroup(o) && o.name === name)) return prev.filter((o) => !(inGroup(o) && o.name === name));
      if (group.max === 1) return [...prev.filter((o) => !inGroup(o)), { group: label, name, delta }];
      if (group.max != null && prev.filter(inGroup).length >= group.max) return prev;
      return [...prev, { group: label, name, delta }];
    });
  };

  const sheetProblem = sheetItem
    ? checkOptionSelection(
        sheetItem.options ?? [],
        sheetOptions.map((o) => (sheetItem.options ?? []).find((opt) => opt.option_group === o.group && opt.option_name === o.name)?.id ?? "?"),
      )
    : null;

  return (
    <main className="min-h-screen bg-gray-50 pb-28">
      <BranchMenuBanner branchName={branchName} />
      {currentHoldReady && hold && <p role="alert" className="mx-4 mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">訂單結果待確認，請先向店員核對；確認前無法新增餐點。您可開啟購物車查看。</p>}
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
        {items.some(i => i.image_url) && <p className="text-xs text-gray-500">{MENU_PHOTO_NOTE}</p>}
        {visibleItems.map(item => (
          <div key={item.id} className="rounded-xl bg-white border border-gray-200 overflow-hidden flex">
            {item.image_url && (
              <ZoomableImage src={item.image_url} alt={item.name} sizes="96px" className="h-24 w-24 shrink-0" />
            )}
            <div className="flex flex-1 items-center justify-between p-3">
              <div>
                <p className="font-medium text-gray-900">{item.name}</p>
                {item.description && <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>}
                <p className="text-amber-700 font-bold mt-1">${item.price}</p>
              </div>
              <button
                type="button"
                aria-label={`選擇${item.name}`}
                disabled={hold || !currentHoldReady}
                onClick={() => openSheet(item)}
                className="ml-3 rounded-full bg-amber-600 h-9 w-9 flex items-center justify-center text-white shrink-0 disabled:opacity-50"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>
        ))}
        {loadError && <p role="alert" className="text-center text-rose-700 py-12">{loadError}</p>}
        {loading && <p role="status" className="text-center text-gray-500 py-12">載入菜單中…</p>}
        {!loading && !loadError && visibleItems.length === 0 && (
          <p className="text-center text-gray-400 py-12">此分類尚無餐點</p>
        )}
      </div>

      {/* 浮動購物車按鈕 */}
      {!loading && !loadError && cartCount > 0 && (
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
            {optionGroupRules(sheetItem.options ?? []).map((group) => (
              <div key={group.key} className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">
                  {group.label}
                  <span className="ml-2 text-xs text-gray-500">
                    {group.min >= 1 ? (group.max === 1 ? "必選一個" : `至少選 ${group.min} 項`) : group.max === 1 ? "可不選" : group.max ? `可多選，最多 ${group.max} 項` : "可多選"}
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {(sheetItem.options ?? []).filter((o) => group.optionIds.includes(o.id)).map((opt) => {
                    const selected = sheetOptions.some((o) => o.group === group.label && o.name === opt.option_name);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleOption(sheetItem, group.key, opt.option_name, Number(opt.price_delta))}
                        className={`rounded-full px-3 py-1.5 text-sm border ${selected ? "bg-amber-600 text-white border-amber-600" : "border-gray-300 text-gray-700"}`}
                      >
                        {opt.option_name}{Number(opt.price_delta) > 0 ? ` +$${opt.price_delta}` : ""}
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
                disabled={hold || !currentHoldReady || Boolean(sheetProblem)}
                className="flex-1 rounded-xl bg-amber-600 py-3 font-bold text-white disabled:opacity-50"
              >
                {sheetProblem ?? "加入購物車"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
