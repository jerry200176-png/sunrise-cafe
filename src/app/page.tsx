import Link from "next/link";
import Image from "next/image";
import { Calendar, Search, ArrowUpRight, Coffee, UtensilsCrossed, MessageCircleHeart } from "lucide-react";

const features = [
  { icon: Coffee, title: "包廂租借", desc: "獨立空間，自在聚會" },
  { icon: UtensilsCrossed, title: "自助點餐", desc: "掃碼即點，現做上桌" },
  { icon: MessageCircleHeart, title: "LINE 通知", desc: "預約確認即時提醒" },
];

export default function Home() {
  return (
    <main className="grain relative min-h-screen overflow-hidden">
      {/* 晨曦：右上灑落的暖光 */}
      <div
        aria-hidden
        className="sun-breathe pointer-events-none absolute -right-24 -top-32 h-[28rem] w-[28rem] rounded-full blur-2xl"
        style={{ background: "radial-gradient(circle, rgba(240,194,122,0.55) 0%, rgba(240,194,122,0) 70%)" }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-6 pb-12 pt-14 md:max-w-xl md:pt-20">

        {/* ───── Hero ───── */}
        <header className="flex flex-col items-center text-center">
          {/* 升起的太陽 + Logo */}
          <div className="rise relative mb-7 flex items-center justify-center" style={{ animationDelay: "0ms" }}>
            <div
              aria-hidden
              className="sun-breathe absolute -bottom-4 left-1/2 h-32 w-32 -translate-x-1/2 rounded-full blur-md"
              style={{ background: "radial-gradient(circle at 50% 60%, var(--amber-glow) 0%, rgba(240,194,122,0) 70%)" }}
            />
            <div className="relative overflow-hidden rounded-[1.75rem] bg-white ring-1 ring-ink/5 shadow-[0_16px_36px_-14px_rgba(157,101,25,0.4)]">
              <Image src="/logo.webp" alt="昇咖啡" width={108} height={108} priority className="block" />
            </div>
          </div>

          <h1 className="rise font-serif text-[2.75rem] font-light leading-none tracking-[0.3em] text-ink" style={{ animationDelay: "120ms", paddingLeft: "0.3em" }}>
            昇咖啡
          </h1>

          <div className="rise my-5 flex items-center gap-3" style={{ animationDelay: "220ms" }}>
            <span className="h-px w-8" style={{ background: "var(--line)" }} />
            <span className="font-display text-xs uppercase tracking-[0.42em] text-caramel-deep">Sunrise&nbsp;Café</span>
            <span className="h-px w-8" style={{ background: "var(--line)" }} />
          </div>

          <p className="rise max-w-xs text-[0.95rem] font-light leading-relaxed tracking-wide text-ink-soft" style={{ animationDelay: "300ms" }}>
            沐浴在晨光裡的精品咖啡館
            <br />
            <span className="text-ink-faint">包廂租借 · 線上預約</span>
          </p>
        </header>

        {/* ───── 主要行動 ───── */}
        <nav className="mt-12 space-y-3.5">
          <Link
            href="/book"
            className="rise group relative flex items-center gap-4 overflow-hidden rounded-[1.4rem] p-[1.15rem] text-left shadow-[0_10px_30px_-12px_rgba(157,101,25,0.45)] transition-transform duration-300 hover:-translate-y-0.5"
            style={{ animationDelay: "420ms", background: "linear-gradient(135deg, #b5742c 0%, #9d6519 100%)" }}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 text-paper ring-1 ring-white/25 backdrop-blur-sm">
              <Calendar className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block font-serif text-lg tracking-wide text-paper">我要訂位</span>
              <span className="mt-0.5 block text-xs tracking-wide text-paper/70">選擇包廂、日期與時段</span>
            </span>
            <ArrowUpRight className="h-5 w-5 text-paper/80 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>

          <Link
            href="/book/query"
            className="rise group flex items-center gap-4 rounded-[1.4rem] border border-ink/10 bg-white/70 p-[1.15rem] text-left shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-caramel/40 hover:bg-white"
            style={{ animationDelay: "520ms" }}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-paper-deep text-caramel-deep ring-1 ring-ink/5">
              <Search className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block font-serif text-lg tracking-wide text-ink">查詢我的訂位</span>
              <span className="mt-0.5 block text-xs tracking-wide text-ink-faint">以電話查詢或取消預約</span>
            </span>
            <ArrowUpRight className="h-5 w-5 text-ink-faint transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </nav>

        {/* ───── 特色 ───── */}
        <section className="rise mt-14" style={{ animationDelay: "640ms" }}>
          <div className="mb-5 flex items-center gap-3">
            <span className="font-display text-[0.65rem] uppercase tracking-[0.4em] text-ink-faint">What we offer</span>
            <span className="h-px flex-1" style={{ background: "var(--line)" }} />
          </div>
          <ul className="grid grid-cols-3 gap-3">
            {features.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex flex-col items-center rounded-2xl border border-ink/[0.07] bg-white/50 px-2 py-5 text-center backdrop-blur-sm">
                <Icon className="h-6 w-6 text-caramel-deep" strokeWidth={1.5} />
                <span className="mt-3 font-serif text-sm tracking-wide text-ink">{title}</span>
                <span className="mt-1 text-[0.68rem] leading-snug text-ink-faint">{desc}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ───── Footer ───── */}
        <footer className="rise mt-auto pt-16 text-center" style={{ animationDelay: "760ms" }}>
          <p className="font-display text-[0.6rem] uppercase tracking-[0.5em] text-ink-faint/70">
            Sunrise Café · since 2024
          </p>
        </footer>
      </div>
    </main>
  );
}
