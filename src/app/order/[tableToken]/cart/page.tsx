"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Trash2, Plus, Minus } from "lucide-react";
import type { CartItem } from "@/types";

export default function CartPage() {
  const { tableToken } = useParams<{ tableToken: string }>();
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`cart-${tableToken}`);
      if (saved) setCart(JSON.parse(saved));
    } catch { /* ignore */ }
  }, [tableToken]);

  const saveCart = (updated: CartItem[]) => {
    setCart(updated);
    localStorage.setItem(`cart-${tableToken}`, JSON.stringify(updated));
  };

  const changeQty = (idx: number, delta: number) => {
    const updated = [...cart];
    updated[idx] = { ...updated[idx], quantity: Math.max(1, updated[idx].quantity + delta) };
    saveCart(updated);
  };

  const removeItem = (idx: number) => {
    const updated = cart.filter((_, i) => i !== idx);
    saveCart(updated);
  };

  const total = cart.reduce((sum, ci) => {
    const delta = ci.selectedOptions.reduce((d, o) => d + o.delta, 0);
    return sum + (ci.menuItem.price + delta) * ci.quantity;
  }, 0);

  const submit = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableToken, items: cart, notes: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "送出失敗");
      localStorage.removeItem(`cart-${tableToken}`);
      router.push(`/order/${tableToken}/success?orderId=${data.orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "送出失敗，請重試");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 pb-32">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-bold text-gray-900">確認訂單</h1>
      </header>

      <div className="px-4 py-4 space-y-3">
        {cart.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400">購物車是空的</p>
            <button type="button" onClick={() => router.back()} className="mt-4 text-amber-600 font-medium">
              返回選餐
            </button>
          </div>
        ) : (
          <>
            {cart.map((ci, idx) => {
              const unitPrice = ci.menuItem.price + ci.selectedOptions.reduce((d, o) => d + o.delta, 0);
              return (
                <div key={idx} className="rounded-xl bg-white border border-gray-200 p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{ci.menuItem.name}</p>
                      {ci.selectedOptions.length > 0 && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {ci.selectedOptions.map(o => o.name).join("・")}
                        </p>
                      )}
                      {ci.specialNotes && (
                        <p className="text-xs text-amber-700 mt-0.5">備註：{ci.specialNotes}</p>
                      )}
                      <p className="text-amber-700 font-medium mt-1">${unitPrice} × {ci.quantity} = ${unitPrice * ci.quantity}</p>
                    </div>
                    <button type="button" onClick={() => removeItem(idx)} className="text-red-400 ml-3">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <div className="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-1">
                      <button type="button" onClick={() => changeQty(idx, -1)}><Minus className="h-4 w-4 text-gray-600" /></button>
                      <span className="font-bold w-5 text-center text-sm">{ci.quantity}</span>
                      <button type="button" onClick={() => changeQty(idx, 1)}><Plus className="h-4 w-4 text-gray-600" /></button>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="rounded-xl bg-white border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-700 mb-2">整體備註</p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="有特殊需求請備註"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">{error}</p>
            )}
          </>
        )}
      </div>

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="font-medium text-gray-700">合計</span>
            <span className="text-xl font-bold text-gray-900">${total}</span>
          </div>
          <p className="text-xs text-gray-400 mb-3 text-center">點餐後請至櫃台付款結帳</p>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="w-full rounded-xl bg-amber-600 py-4 font-bold text-white text-lg disabled:opacity-60"
          >
            {submitting ? "送出中…" : "確認送出訂單"}
          </button>
        </div>
      )}
    </main>
  );
}
