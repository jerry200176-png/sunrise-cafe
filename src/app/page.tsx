"use client";

import Link from "next/link";
import { Calendar, Search, Settings } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 py-12">
        <h1 className="text-2xl font-bold text-gray-900">昇咖啡</h1>
        <p className="mt-1 text-gray-600">包廂訂位</p>
        <nav className="mt-10 w-full space-y-3">
          <Link
            href="/book"
            className="flex w-full items-center gap-4 rounded-xl border border-amber-200 bg-white p-4 shadow-sm hover:border-amber-400 hover:bg-amber-50/50"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Calendar className="h-6 w-6" />
            </span>
            <div className="text-left">
              <p className="font-semibold text-gray-900">我要訂位</p>
              <p className="text-sm text-gray-500">選擇分店、包廂與時段</p>
            </div>
          </Link>
          <Link
            href="/book/query"
            className="flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-gray-300 hover:bg-gray-50"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-600">
              <Search className="h-6 w-6" />
            </span>
            <div className="text-left">
              <p className="font-semibold text-gray-900">查詢我的訂位</p>
              <p className="text-sm text-gray-500">以電話查詢、取消訂位</p>
            </div>
          </Link>
          <Link
            href="/admin"
            className="flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-gray-300 hover:bg-gray-50"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-600">
              <Settings className="h-6 w-6" />
            </span>
            <div className="text-left">
              <p className="font-semibold text-gray-900">後台管理</p>
              <p className="text-sm text-gray-500">分店、包廂與訂位管理</p>
            </div>
          </Link>
        </nav>
      </div>
    </main>
  );
}
