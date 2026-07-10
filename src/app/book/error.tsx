"use client";

import Link from "next/link";

export default function BookError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50/40 to-white flex items-center justify-center px-4">
      <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">訂位頁面發生錯誤</h1>
        <p className="mt-2 text-sm text-gray-600">
          {error.message || "請稍後再試，或返回首頁重新開始。"}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-700"
          >
            重試
          </button>
          <Link
            href="/"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            返回首頁
          </Link>
        </div>
      </div>
    </main>
  );
}
