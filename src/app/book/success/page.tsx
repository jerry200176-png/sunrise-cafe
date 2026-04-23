"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ArrowLeft, Clock } from "lucide-react";

const OFFICIAL_LINE_URL = "https://lin.ee/cxcV0lo";

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
          <p className="mt-2 text-center text-sm text-gray-500">
            請保存下方訂位代號，並等待店家確認通知。
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

          <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-blue-500 shrink-0" />
              <p className="font-semibold text-blue-800">等待店家確認中</p>
            </div>
            <p className="text-sm text-blue-700 leading-relaxed">
              我們已收到您的訂位申請！店家確認後會主動聯繫通知您繳納訂金，
              <strong>請勿提前匯款</strong>，以免造成困擾。
            </p>
          </div>

          {code && (
            <div className="mt-4 rounded-xl border border-green-100 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-800 mb-1">📲 用 LINE 接收訂位確認通知</p>
              <p className="text-xs text-green-700 leading-relaxed mb-3">
                點下方按鈕，開啟 LINE 後直接按送出，店家確認後將自動通知您！
              </p>
              <a
                href={`https://line.me/R/oaMessage/@413pvgwz/?text=${encodeURIComponent(code)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-[#06C755] px-4 py-2 text-sm font-semibold text-white hover:bg-green-600 transition"
              >
                <span>💬</span>
                一鍵傳送訂位代號
              </a>
            </div>
          )}

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
