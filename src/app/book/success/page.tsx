"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ArrowLeft } from "lucide-react";

const LINE_PAY_URL =
  "https://qrcodepay.line.me/qr/payment/%252BmF6rR41PSp3R8NMydLA%252BRt1IvAFgPchBvtrJoR20aoZKY4Hr1qrbfaYSoPDUyu0";
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
          <p className="mt-2 text-center text-gray-600">
            訂位需預付訂金才算完成預約。請依下方說明完成付款。
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
          <div className="mt-5 rounded-lg border-2 border-gray-200 bg-white p-4 text-base text-gray-800 shadow-sm">
            <p className="font-bold text-xl text-gray-900 mb-3 border-b-2 border-gray-100 pb-2">
              📥 兩步驟完成繳費
            </p>

            <div className="mb-5 pl-3 border-l-4 border-amber-400 bg-gray-50 p-3 rounded-r-lg">
              <p className="font-bold text-lg text-amber-800 mb-2">
                【 第 1 步：選擇以下任一方式付款 】
              </p>
              <div className="bg-white p-3 rounded border border-gray-200 shadow-sm mb-3">
                <p className="font-bold text-gray-700 flex items-center gap-1.5 mb-1">
                  <span className="text-xl">🏦</span> 銀行轉帳
                </p>
                <p className="font-mono text-lg tracking-wide select-all">台北富邦銀行 (012)</p>
                <p className="font-mono text-xl font-bold tracking-wider select-all text-blue-700 my-1">8212-00000-8489-6</p>
                <p className="text-base font-semibold">戶名：昇昇咖啡張文霞</p>
              </div>

              <div className="flex items-center gap-3 my-2 opacity-60">
                <div className="h-px flex-1 bg-gray-300"></div>
                <span className="font-medium text-sm">或者</span>
                <div className="h-px flex-1 bg-gray-300"></div>
              </div>

              <div className="mt-2 text-center">
                <a
                  href={LINE_PAY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full sm:w-auto justify-center items-center gap-2 rounded-lg bg-[#06C755] px-6 py-3 text-base font-bold text-white shadow hover:bg-[#05b34c] transition"
                >
                  <span className="bg-white text-[#06C755] p-1 rounded font-black text-xs">LINE Pay</span>
                  點此開啟 LINE Pay 付款
                </a>
              </div>
            </div>

            <div className="pl-3 border-l-4 border-[#06C755] bg-green-50/50 p-3 rounded-r-lg">
              <p className="font-bold text-lg text-[#06C755] mb-2">
                【 第 2 步：務必加官方 LINE 回傳 】
              </p>
              <p className="mb-4 text-gray-700 leading-relaxed text-base">
                付款完成後，請點擊下方按鈕加入官方 LINE，拍下您的<strong>「付款截圖」</strong>或告訴我們您的<strong>「帳號後五碼」</strong>，我們確認收到錢後，位子才算真正為您保留喔！
              </p>
              <a
                href={OFFICIAL_LINE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full sm:w-auto justify-center items-center gap-2 rounded-lg border-2 border-[#06C755] bg-white px-6 py-3 text-base font-bold text-[#06C755] shadow-sm hover:bg-green-50 transition"
              >
                <span className="text-xl">💬</span>
                加官方 LINE 傳截圖
              </a>
            </div>
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
