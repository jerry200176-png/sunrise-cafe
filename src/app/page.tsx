"use client";

import Link from "next/link";
import Image from "next/image";
import { Calendar, Search, ChevronRight } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50/70 via-white to-white">
      <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 py-16">

        {/* Logo */}
        <div className="relative mb-5 h-24 w-24 drop-shadow-lg">
          <Image src="/logo.webp" alt="昇咖啡" fill className="object-contain" priority />
        </div>

        {/* 店名 */}
        <h1 className="text-3xl font-light tracking-[0.35em] text-stone-800">昇咖啡</h1>

        {/* 裝飾分隔線 */}
        <div className="my-4 flex items-center gap-3">
          <span className="h-px w-10 bg-amber-400/70" />
          <span className="text-[10px] tracking-[0.25em] text-amber-600/80 uppercase">Private Room Reservation</span>
          <span className="h-px w-10 bg-amber-400/70" />
        </div>

        <p className="mb-10 text-sm tracking-[0.15em] text-stone-400">包廂租借訂位</p>

        {/* 導航卡片 */}
        <nav className="w-full space-y-3">
          <Link
            href="/book"
            className="group flex w-full items-center gap-4 rounded-2xl border border-amber-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-amber-400 hover:shadow-md"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200 transition-all group-hover:bg-amber-100">
              <Calendar className="h-5 w-5" />
            </span>
            <div className="flex-1 text-left">
              <p className="font-medium tracking-wide text-stone-800">我要訂位</p>
              <p className="mt-0.5 text-xs tracking-wide text-stone-400">選擇包廂、日期與時段</p>
            </div>
            <ChevronRight className="h-4 w-4 text-amber-400 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>

          <Link
            href="/book/query"
            className="group flex w-full items-center gap-4 rounded-2xl border border-stone-200 bg-white/90 p-5 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-stone-300 hover:shadow-md"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stone-50 text-stone-500 ring-1 ring-stone-200 transition-all group-hover:bg-stone-100">
              <Search className="h-5 w-5" />
            </span>
            <div className="flex-1 text-left">
              <p className="font-medium tracking-wide text-stone-800">查詢我的訂位</p>
              <p className="mt-0.5 text-xs tracking-wide text-stone-400">以電話查詢或取消訂位</p>
            </div>
            <ChevronRight className="h-4 w-4 text-stone-300 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        </nav>

        {/* 底部品牌字 */}
        <p className="mt-14 text-[10px] tracking-[0.4em] text-stone-300 uppercase">Sunrise Café</p>
      </div>
    </main>
  );
}
