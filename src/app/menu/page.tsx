"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Branch, MenuCategory, MenuItem } from "@/types";

export default function PublicMenuPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/branches").then((r) => r.json()).then((data) => setBranches(Array.isArray(data) ? data : []))
      .catch(() => setError("暫時無法載入分店，請稍後再試。"));
  }, []);
  useEffect(() => {
    if (!branchId) return;
    const controller = new AbortController();
    setError("");
    fetch(`/api/menu?branchId=${encodeURIComponent(branchId)}`, { signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error("菜單載入失敗"); return r.json(); })
      .then((data) => { setCategories(data.categories ?? []); setItems(data.items ?? []); })
      .catch(() => { if (!controller.signal.aborted) setError("暫時無法載入菜單，請稍後再試。"); });
    return () => controller.abort();
  }, [branchId]);

  return <main className="min-h-screen bg-[#f7f4ed] text-stone-900">
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
      <header className="border-b border-stone-300 pb-6">
        <p className="text-xs font-semibold tracking-[0.18em] text-amber-800">SUNRISE CAFE</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">昇昇咖啡菜單</h1>
        <p className="mt-2 text-sm text-stone-600">先選分店，再看看今天想吃什麼。菜單可自由瀏覽，不需訂位。</p>
        <label className="mt-5 block max-w-sm text-sm font-medium" htmlFor="menu-branch">選擇分店</label>
        <select id="menu-branch" className="mt-2 w-full max-w-sm rounded-lg border border-stone-300 bg-white px-3 py-3"
          value={branchId} onChange={(event) => setBranchId(event.target.value)}>
          <option value="">請選擇分店</option>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </header>
      {error && <p role="alert" className="mt-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">{error}</p>}
      {branchId && !error && <div className="mt-7 space-y-9">
        {categories.map((category) => {
          const group = items.filter((item) => item.category_id === category.id);
          if (!group.length) return null;
          return <section key={category.id} aria-labelledby={`category-${category.id}`}>
            <h2 id={`category-${category.id}`} className="border-b border-amber-700 pb-2 text-xl font-semibold">{category.name}</h2>
            <div className="divide-y divide-stone-200">{group.map((item) => <MenuRow key={item.id} item={item} />)}</div>
          </section>;
        })}
        {items.filter((item) => !item.category_id).length > 0 &&
          <section><h2 className="border-b border-amber-700 pb-2 text-xl font-semibold">其他餐點</h2><div className="divide-y divide-stone-200">
            {items.filter((item) => !item.category_id).map((item) => <MenuRow key={item.id} item={item} />)}
          </div></section>}
        {items.length === 0 && <p className="text-stone-600">這家分店目前還沒有上架菜單。</p>}
        <p className="border-t border-stone-300 pt-5 text-sm text-stone-600">餐點與價格以店內當日供應為準。想預約包廂？ <Link href="/book" className="font-semibold text-amber-800 underline">前往訂位</Link></p>
      </div>}
    </div>
  </main>;
}

function MenuRow({ item }: { item: MenuItem }) {
  return <article className="flex gap-4 py-4">
    {item.image_url && <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-stone-200">
      <Image src={item.image_url} alt={item.name} fill unoptimized sizes="80px" className="object-cover" />
    </div>}
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{item.name}</h3><span className="shrink-0 font-semibold">NT$ {Number(item.price).toLocaleString()}</span></div>
      {item.description && <p className="mt-1 text-sm text-stone-600">{item.description}</p>}
      {!item.is_available && <p className="mt-1 text-sm font-medium text-rose-700">暫停供應</p>}
    </div>
  </article>;
}
