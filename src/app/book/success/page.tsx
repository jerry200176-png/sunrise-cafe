"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ArrowLeft } from "lucide-react";

function SuccessContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code") ?? "";

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="rounded-2xl border border-green-200 bg-white p-6 shadow-lg">
          <div className="flex justify-center text-green-600">
            <CheckCircle2 className="h-14 w-14" />
          </div>
          <h1 className="mt-4 text-center text-xl font-bold text-gray-900">預約申請已送出</h1>
          <p className="mt-2 text-center text-gray-600">
            預約申請已送出！我們將儘快確認包廂狀況。若確認有位，將會傳送匯款資訊給您，請留意 LINE 或簡訊。
          </p>
          {code && (
            <div className="mt-6 rounded-xl bg-amber-50 p-4 text-center">
              <p className="text-sm text-amber-800">訂位代號</p>
              <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-amber-900">
                {code}
              </p>
              <p className="mt-3 text-xs text-amber-700">建議截圖保存，查詢或取消訂位時會用到</p>
            </div>
          )}
          <div className="mt-6">
            <Link
              href="https://line.me/ti/p/~@sunrise_cafe"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-lg bg-green-600 py-3 text-center text-sm font-medium text-white hover:bg-green-700"
            >
              加入官方 LINE (@sunrise_cafe)
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            <Link
              href="/book/query"
              className="block w-full rounded-lg bg-amber-600 py-3 text-center font-medium text-white hover:bg-amber-700"
            >
              查詢我的訂位
            </Link>
            <Link
              href="/"
              className="flex items-center justify-center gap-2 py-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" /> 返回首頁
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function BookSuccessPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">載入中...</p>
      </main>
    }>
      <SuccessContent />
    </Suspense>
  );
}
