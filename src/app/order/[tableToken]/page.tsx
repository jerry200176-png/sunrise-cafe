"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { UtensilsCrossed } from "lucide-react";

export default function OrderEntryPage() {
  const { tableToken } = useParams<{ tableToken: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<{ number: string; branches: { name: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/tables/${tableToken}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setInfo(d);
      })
      .catch(() => setError("無法連線，請重試"));
  }, [tableToken]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-amber-50 p-6">
        <div className="text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-sm text-gray-500 mt-2">請重新掃描 QR Code</p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-amber-50">
        <p className="text-gray-500">載入中…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-amber-50 p-6">
      <div className="text-center space-y-6 max-w-xs w-full">
        <div className="w-20 h-20 rounded-full bg-amber-600 flex items-center justify-center mx-auto">
          <UtensilsCrossed className="h-10 w-10 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{(info as { branches?: { name: string } }).branches?.name ?? "日出咖啡館"}</h1>
          <p className="text-gray-600 mt-1">桌號 <span className="font-bold text-amber-700">{info.number}</span></p>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/order/${tableToken}/menu`)}
          className="w-full rounded-xl bg-amber-600 py-4 text-lg font-bold text-white hover:bg-amber-700 shadow-lg"
        >
          開始點餐
        </button>
        <p className="text-xs text-gray-400">點餐後請至櫃台結帳</p>
      </div>
    </main>
  );
}
