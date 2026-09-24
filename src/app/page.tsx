"use client";

import Link from "next/link";
import Image from "next/image";
import { Calendar, Search, ArrowUpRight, Coffee, UtensilsCrossed, MessageCircleHeart } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function Home() {
  const { t } = useLocale();
  const features = [
    { icon: Coffee, title: t("home.feature.room"), desc: t("home.feature.roomDesc") },
    { icon: UtensilsCrossed, title: t("home.feature.order"), desc: t("home.feature.orderDesc") },
    { icon: MessageCircleHeart, title: t("home.feature.line"), desc: t("home.feature.lineDesc") },
  ];

  return (
    <main className="grain relative min-h-[100dvh] overflow-hidden">
      {/* Full-bleed morning light plane */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 70% at 78% -8%, rgba(240,194,122,0.48) 0%, rgba(240,194,122,0) 58%), radial-gradient(70% 55% at 8% 100%, rgba(192,131,47,0.14) 0%, rgba(192,131,47,0) 55%)",
        }}
      />
      <div
        aria-hidden
        className="sun-breathe pointer-events-none absolute -right-28 -top-40 h-[34rem] w-[34rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(240,194,122,0.42) 0%, rgba(240,194,122,0) 70%)" }}
      />

      {/* ───── Hero (first viewport) ───── */}
      <section className="relative mx-auto flex min-h-[100dvh] max-w-md flex-col px-6 pb-10 pt-10 md:max-w-xl md:pt-14">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>

        <header className="mt-10 flex flex-1 flex-col justify-center text-left md:mt-6">
          <div className="rise mb-8" style={{ animationDelay: "0ms" }}>
            <Image
              src="/logo.webp"
              alt={t("home.brandName")}
              width={88}
              height={88}
              priority
              className="block h-[5.5rem] w-[5.5rem] object-contain"
            />
          </div>

          <p
            className="rise font-display text-[0.7rem] uppercase tracking-[0.42em] text-caramel-deep"
            style={{ animationDelay: "80ms" }}
          >
            Sunrise&nbsp;Café
          </p>

          <h1
            className="rise mt-4 font-serif text-[3.15rem] font-light leading-[1.08] tracking-[0.22em] text-ink text-balance md:text-[3.5rem]"
            style={{ animationDelay: "140ms", paddingLeft: "0.08em" }}
          >
            {t("home.brandName")}
          </h1>

          <p
            className="rise mt-6 max-w-[22rem] text-[1.02rem] font-light leading-relaxed tracking-wide text-ink-soft text-pretty"
            style={{ animationDelay: "220ms" }}
          >
            {t("home.tagline1")}
            <span className="mt-1.5 block text-[0.92rem] text-ink-faint">{t("home.tagline2")}</span>
          </p>

          <nav className="mt-10 flex flex-col gap-3.5 sm:max-w-md" aria-label={t("home.brandName")}>
            <Link
              href="/book"
              className="rise group relative flex items-center gap-4 overflow-hidden rounded-[1.5rem] px-4 py-[1.05rem] text-left shadow-[0_14px_34px_-14px_rgba(157,101,25,0.5)] transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-14px_rgba(157,101,25,0.55)] active:scale-[0.985]"
              style={{ animationDelay: "320ms", background: "linear-gradient(135deg, #b5742c 0%, #9d6519 100%)" }}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-paper ring-1 ring-white/25">
                <Calendar className="h-5 w-5" strokeWidth={1.5} />
              </span>
              <span className="flex-1">
                <span className="block font-serif text-lg tracking-wide text-paper">{t("home.bookCta")}</span>
                <span className="mt-0.5 block text-xs tracking-wide text-paper/70">{t("home.bookCtaDesc")}</span>
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-paper transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
              </span>
            </Link>

            <Link
              href="/book/query"
              className="rise group flex items-center gap-4 rounded-[1.5rem] border border-ink/10 bg-white/55 px-4 py-[1.05rem] text-left backdrop-blur-[2px] transition-[transform,border-color,background-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:border-caramel/35 hover:bg-white/80 active:scale-[0.985]"
              style={{ animationDelay: "420ms" }}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-paper-deep text-caramel-deep ring-1 ring-ink/5">
                <Search className="h-5 w-5" strokeWidth={1.5} />
              </span>
              <span className="flex-1">
                <span className="block font-serif text-lg tracking-wide text-ink">{t("home.queryCta")}</span>
                <span className="mt-0.5 block text-xs tracking-wide text-ink-faint">{t("home.queryCtaDesc")}</span>
              </span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-deep/80 text-ink-faint transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-caramel-deep">
                <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
              </span>
            </Link>
            <Link href="/menu" className="self-start px-2 py-1 text-sm font-medium text-caramel-deep underline underline-offset-4">
              不訂位也能先看菜單 →
            </Link>
          </nav>
        </header>

        <div
          className="rise mt-8 flex items-center gap-3 pt-2"
          style={{ animationDelay: "520ms" }}
          aria-hidden
        >
          <span className="h-px flex-1" style={{ background: "var(--line)" }} />
          <span className="font-display text-[0.58rem] uppercase tracking-[0.38em] text-ink-faint/80">
            {t("home.sectionLabel")}
          </span>
          <span className="h-px w-10" style={{ background: "var(--line)" }} />
        </div>
      </section>

      {/* ───── Offerings (below fold, asymmetric — not 3 equal cards) ───── */}
      <section className="relative mx-auto max-w-md px-6 pb-8 md:max-w-xl">
        <ul className="space-y-0 divide-y divide-ink/[0.08]">
          {features.map(({ icon: Icon, title, desc }, index) => (
            <li
              key={title}
              className="rise group flex items-start gap-4 py-6 first:pt-2"
              style={{ animationDelay: `${600 + index * 90}ms`, paddingLeft: index === 1 ? "1.25rem" : index === 2 ? "0.35rem" : "0" }}
            >
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.9rem] bg-paper-deep text-caramel-deep ring-1 ring-ink/5 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-0.5">
                <Icon className="h-5 w-5" strokeWidth={1.5} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 className="font-serif text-[1.05rem] tracking-wide text-ink">{title}</h2>
                <p className="mt-1 max-w-[28ch] text-sm leading-relaxed text-ink-faint">{desc}</p>
              </div>
              <span className="pt-2 font-display text-[0.65rem] tabular-nums tracking-[0.18em] text-ink-faint/60">
                {String(index + 1).padStart(2, "0")}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="rise relative mx-auto max-w-md px-6 pb-14 pt-4 text-left md:max-w-xl" style={{ animationDelay: "900ms" }}>
        <p className="font-display text-[0.6rem] uppercase tracking-[0.45em] text-ink-faint/70">
          {t("home.footer")}
        </p>
      </footer>
    </main>
  );
}
