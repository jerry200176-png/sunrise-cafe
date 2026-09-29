"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import type { Branch, MenuCategory, MenuItem } from "@/types";

const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]";

export default function PublicMenuPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/branches").then((r) => r.json()).then((data) => {
      const list: Branch[] = Array.isArray(data) ? data : [];
      setBranches(list);
      if (list.length === 1) setBranchId(list[0].id);
    }).catch(() => setError("暫時無法載入分店，請稍後再試。"));
  }, []);
  useEffect(() => {
    if (!branchId) return;
    const controller = new AbortController();
    setError("");
    setLoading(true);
    fetch(`/api/menu?branchId=${encodeURIComponent(branchId)}`, { signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error("菜單載入失敗"); return r.json(); })
      .then((data) => { setCategories(data.categories ?? []); setItems(data.items ?? []); })
      .catch(() => { if (!controller.signal.aborted) setError("暫時無法載入菜單，請稍後再試。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [branchId]);

  const sections = [
    ...categories.map((c) => ({ id: c.id, name: c.name, items: items.filter((i) => i.category_id === c.id) })),
    { id: "other", name: "其他餐點", items: items.filter((i) => !i.category_id) },
  ].filter((s) => s.items.length > 0);

  return <main className="grain relative min-h-[100dvh] overflow-x-clip bg-paper text-ink">
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[28rem]"
      style={{ background: "radial-gradient(80% 70% at 85% -10%, rgba(240,194,122,0.45) 0%, rgba(240,194,122,0) 60%)" }} />

    <div className="relative mx-auto max-w-md px-6 pb-20 pt-8 md:max-w-xl">
      <Link href="/" className={`inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-soft transition-colors duration-300 ${EASE} hover:text-caramel-deep`}>
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />回首頁
      </Link>

      <header className="mt-8">
        <p className="rise font-display text-[0.7rem] uppercase tracking-[0.42em] text-caramel-deep">Sunrise&nbsp;Café · Menu</p>
        <h1 className="rise mt-3 font-serif text-[2.6rem] font-light leading-tight tracking-[0.2em] text-ink" style={{ animationDelay: "80ms" }}>菜單</h1>
        <p className="rise mt-3 text-[0.95rem] font-light leading-relaxed text-ink-soft" style={{ animationDelay: "160ms" }}>
          先選分店，再慢慢看今天想吃什麼。<span className="block text-sm text-ink-faint">菜單可自由瀏覽，不需訂位。</span>
        </p>

        {branches.length > 1 && <fieldset className="rise mt-8" style={{ animationDelay: "240ms" }}>
          <legend className="text-xs uppercase tracking-[0.3em] text-ink-faint">選擇分店</legend>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {branches.map((b) => {
              const active = b.id === branchId;
              return <button key={b.id} type="button" aria-pressed={active} onClick={() => setBranchId(b.id)}
                className={`min-h-11 rounded-full border px-5 text-[0.95rem] transition-[background-color,border-color,color,transform] duration-300 ${EASE} active:scale-[0.97] ${active
                  ? "border-transparent text-paper shadow-[0_10px_30px_-12px_rgba(157,101,25,0.45)]"
                  : "border-ink/10 bg-white/55 text-ink-soft backdrop-blur hover:border-caramel/60 hover:text-ink"}`}
                style={active ? { background: "linear-gradient(135deg,#b5742c,#9d6519)" } : undefined}>
                {b.name}
              </button>;
            })}
          </div>
        </fieldset>}
      </header>

      {error && <p role="alert" className="mt-8 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-rose-800">{error}</p>}

      {!branchId && !error && branches.length > 1 &&
        <p className="mt-12 border-t border-latte pt-6 text-center font-serif text-ink-faint">— 請先選擇分店 —</p>}

      {branchId && !error && loading && <div aria-busy="true" aria-label="菜單載入中" className="mt-12 space-y-5">
        {[0, 1, 2, 3].map((i) => <div key={i} className="flex gap-4">
          <div className="h-20 w-20 animate-pulse rounded-2xl bg-latte/70" />
          <div className="flex-1 space-y-2 pt-2"><div className="h-4 w-2/3 animate-pulse rounded bg-latte/70" /><div className="h-3 w-1/2 animate-pulse rounded bg-latte/50" /></div>
        </div>)}
      </div>}

      {branchId && !error && !loading && <>
        {sections.length > 1 && <nav aria-label="菜單分類"
          className="sticky top-0 z-10 -mx-6 mt-10 flex gap-2 overflow-x-auto border-b border-latte bg-paper/85 px-6 py-3 backdrop-blur [scrollbar-width:none]">
          {sections.map((s) => <a key={s.id} href={`#category-${s.id}`}
            className={`shrink-0 rounded-full border border-ink/10 bg-white/55 px-4 py-1.5 text-sm text-ink-soft transition-[border-color,color] duration-300 ${EASE} hover:border-caramel/60 hover:text-caramel-deep`}>
            {s.name}
          </a>)}
        </nav>}

        <div className="mt-10 space-y-14">
          {sections.map((s, idx) => <section key={s.id} id={`category-${s.id}`} aria-labelledby={`h-${s.id}`} className="scroll-mt-20">
            <div className="flex items-baseline gap-3">
              <span className="font-display text-sm text-caramel">{String(idx + 1).padStart(2, "0")}</span>
              <h2 id={`h-${s.id}`} className="font-serif text-2xl tracking-[0.12em] text-ink">{s.name}</h2>
              <span aria-hidden className="h-px flex-1 translate-y-[-0.3rem] bg-latte" />
            </div>
            <div className="mt-3 divide-y divide-latte/80">{s.items.map((item) => <MenuRow key={item.id} item={item} />)}</div>
          </section>)}
          {items.length === 0 && <p className="text-center font-serif text-ink-faint">這家分店目前還沒有上架菜單。</p>}
        </div>

        <footer className="mt-16 border-t border-latte pt-8">
          <p className="text-sm text-ink-faint">餐點與價格以店內當日供應為準。</p>
          <Link href="/book" className={`group mt-5 flex items-center justify-between rounded-[1.5rem] px-5 py-4 text-paper shadow-[0_10px_30px_-12px_rgba(157,101,25,0.45)] transition-[transform,box-shadow] duration-300 ${EASE} hover:-translate-y-0.5 active:scale-[0.985]`}
            style={{ background: "linear-gradient(135deg,#b5742c,#9d6519)" }}>
            <span><span className="block font-serif text-lg tracking-[0.12em]">想預約包廂？</span><span className="text-sm text-paper/75">前往訂位，帶朋友一起來</span></span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
              <ArrowUpRight className={`h-5 w-5 transition-transform duration-300 ${EASE} group-hover:-translate-y-0.5 group-hover:translate-x-0.5`} strokeWidth={1.5} />
            </span>
          </Link>
        </footer>
      </>}
    </div>
  </main>;
}

function MenuRow({ item }: { item: MenuItem }) {
  return <article className={`flex gap-4 py-5 ${item.is_available ? "" : "opacity-60"}`}>
    {item.image_url && <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-paper-deep ring-1 ring-ink/5 sm:h-24 sm:w-24">
      <Image src={item.image_url} alt={item.name} fill unoptimized sizes="96px" className="object-cover" />
    </div>}
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-2">
        <h3 className="font-serif text-[1.05rem] tracking-wide text-ink">{item.name}</h3>
        <span aria-hidden className="mb-1 min-w-4 flex-1 border-b border-dotted border-ink-faint/50" />
        <span className="shrink-0 font-display text-[1.05rem] text-caramel-deep">NT$ {Number(item.price).toLocaleString()}</span>
      </div>
      {item.description && <p className="mt-1.5 text-sm font-light leading-relaxed text-ink-soft">{item.description}</p>}
      {!item.is_available && <p className="mt-2 inline-block rounded-full bg-paper-deep px-2.5 py-0.5 text-xs text-ink-soft">暫停供應</p>}
    </div>
  </article>;
}
