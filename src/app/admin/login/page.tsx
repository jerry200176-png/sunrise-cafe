"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Lock } from "lucide-react";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push("/admin");
        router.refresh();
      } else {
        setError(data.error || "密碼錯誤");
      }
    } catch {
      setError("連線失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm">
        <div className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-[0_20px_50px_-28px_rgba(68,64,60,0.45)]">
          <div className="border-b border-stone-100 bg-gradient-to-br from-amber-50 to-white px-6 pb-5 pt-7 text-center">
            <div className="relative mx-auto h-14 w-14">
              <Image src="/logo.webp" alt="昇咖啡" fill className="object-contain" priority />
            </div>
            <h1 className="mt-4 text-xl font-semibold tracking-tight text-stone-900">後台登入</h1>
            <p className="mt-1 text-sm text-stone-500">昇咖啡營運中樞</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
            <div>
              <label htmlFor="admin-password" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-stone-700">
                <Lock className="h-3.5 w-3.5 text-amber-700" strokeWidth={1.5} />
                密碼
              </label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入後台密碼"
                className="w-full rounded-xl border border-stone-300 px-4 py-3 text-stone-900 placeholder-stone-400 transition-[border-color,box-shadow] duration-200 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-amber-600 py-3 font-medium text-white transition-[background-color,transform] duration-200 hover:bg-amber-700 active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? "驗證中…" : "登入"}
            </button>
          </form>
        </div>
        <Link
          href="/"
          className="mt-5 flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-sm text-stone-500 transition-[color,background-color] duration-200 hover:bg-white/70 hover:text-stone-700"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden /> 返回首頁
        </Link>
      </div>
    </main>
  );
}
