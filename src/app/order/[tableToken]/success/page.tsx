"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle, UtensilsCrossed } from "lucide-react";
import { Suspense } from "react";

function SuccessContent() {
  const { tableToken } = useParams<{ tableToken: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId") ?? "";
  const shortId = orderId.slice(0, 8).toUpperCase();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-amber-50 p-6">
      <div className="text-center space-y-5 max-w-xs w-full">
        <CheckCircle className="h-20 w-20 text-green-500 mx-auto" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">訂單已送出！</h1>
          <p className="text-gray-500 mt-1 text-sm">餐點準備好後，服務人員將通知您</p>
        </div>
        <div className="rounded-xl bg-white border border-gray-200 px-6 py-4">
          <p className="text-xs text-gray-400">訂單編號</p>
          <p className="text-2xl font-mono font-bold text-gray-900 tracking-widest">#{shortId}</p>
        </div>
        <p className="text-sm text-gray-600 bg-amber-100 rounded-xl px-4 py-3">
          請至<strong>櫃台</strong>付款結帳
        </p>
        <button
          type="button"
          onClick={() => router.push(`/order/${tableToken}/menu`)}
          className="w-full rounded-xl border-2 border-amber-600 py-3 font-bold text-amber-700 hover:bg-amber-50 flex items-center justify-center gap-2"
        >
          <UtensilsCrossed className="h-5 w-5" /> 繼續加點
        </button>
      </div>
    </main>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<main className="min-h-screen flex items-center justify-center bg-amber-50"><p className="text-gray-500">載入中…</p></main>}>
      <SuccessContent />
    </Suspense>
  );
}
