"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Trash2, Plus, Minus } from "lucide-react";
import type { CartItem } from "@/types";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { qrHoldEntries, qrHoldKey, qrIsHoldKey } from "@/lib/qr-order-local-hold";

function parseCart(saved: string | null): CartItem[] {
  const restored: unknown = saved ? JSON.parse(saved) : [];
  if (!Array.isArray(restored)) throw new Error("invalid cart");
  return restored as CartItem[];
}

export default function CartPage() {
  const { tableToken } = useParams<{ tableToken: string }>();
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hold, setHold] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [loadedToken, setLoadedToken] = useState("");
  const inFlight = useRef(false);
  const currentToken = useRef(tableToken);
  currentToken.current = tableToken;
  const holdKey = qrHoldKey(tableToken);
  const cartKey = `cart-${tableToken}`;
  const currentStorageReady = storageReady && loadedToken === tableToken;

  useEffect(() => {
    setStorageReady(false);
    setError(null);
    setNotes("");
    try {
      const saved = localStorage.getItem(cartKey);
      setCart(parseCart(saved));
      setHold(qrHoldEntries(tableToken).length > 0);
      setLoadedToken(tableToken);
      setStorageReady(true);
    } catch { setHold(true); setLoadedToken(tableToken); setStorageReady(true); }
    const onStorage = (event: StorageEvent) => {
      if (qrIsHoldKey(tableToken, event.key)) {
        try { setHold(qrHoldEntries(tableToken).length > 0); } catch { setHold(true); }
      }
      if (event.key === cartKey || event.key === null) {
        try { setCart(parseCart(localStorage.getItem(cartKey))); } catch { setHold(true); }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [tableToken, holdKey, cartKey]);

  const saveCart = (updated: CartItem[]) => {
    try {
      if (qrHoldEntries(tableToken).length) { setHold(true); return; }
      const saved = localStorage.getItem(cartKey);
      if (saved !== JSON.stringify(cart)) { setCart(parseCart(saved)); setError("購物車已更新，請再次確認餐點。"); return; }
      localStorage.setItem(cartKey, JSON.stringify(updated));
      setCart(updated);
    } catch { setHold(true); setError("無法確認購物車狀態，請向店員確認。"); }
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

  const releaseAfterStaffCheck = () => {
    if (inFlight.current || !currentStorageReady) return;
    try {
      const reviewed = qrHoldEntries(tableToken);
      if (!window.confirm("請先請店員核對所有待確認的原訂單與廚房，包含所有備註及過敏資訊。原請求仍可能稍後完成；解除後再送可能造成重複。店員已核對並同意解除嗎？")) return;
      for (const entry of reviewed) {
        if (localStorage.getItem(entry.key) === entry.value) localStorage.removeItem(entry.key);
      }
      const remaining = qrHoldEntries(tableToken).length > 0;
      setHold(remaining);
      setError(remaining ? "仍有待確認的訂單，請再請店員核對。" : "已解除待確認狀態。若仍要送出，請先和店員確認餐點，並自行按下送出。");
    } catch { setHold(true); setError("無法解除待確認狀態，請向店員尋求協助。"); }
  };

  const total = cart.reduce((sum, ci) => {
    const delta = ci.selectedOptions.reduce((d, o) => d + o.delta, 0);
    return sum + (ci.menuItem.price + delta) * ci.quantity;
  }, 0);

  const submit = async () => {
    if (cart.length === 0 || hold || !currentStorageReady || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // Persist the hold before any request; lost responses must survive reload.
      if (qrHoldEntries(tableToken).length) { setHold(true); return; }
      const saved = localStorage.getItem(cartKey);
      if (saved !== JSON.stringify(cart)) {
        setCart(parseCart(saved));
        setError("購物車已更新，請再次確認餐點。");
        return;
      }
      if (!window.crypto?.randomUUID) throw new Error("storage unavailable");
      const marker = `pending:${window.crypto.randomUUID()}`;
      localStorage.setItem(holdKey, marker);
      if (localStorage.getItem(holdKey) !== marker) throw new Error("storage unavailable");
      setHold(true);
      const res = await fetchWithTimeout("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableToken, items: cart, notes: notes.trim() || undefined }),
      });
      const data = await readJsonWithTimeout<{ ok?: boolean; orderId?: string; safe_to_retry?: boolean; error?: string }>(res);
      if (!res.ok) {
        if (data?.safe_to_retry === true) {
          if (localStorage.getItem(holdKey) !== marker) throw new Error("hold changed");
          localStorage.removeItem(holdKey);
          if (localStorage.getItem(holdKey) !== null) throw new Error("storage unavailable");
          if (currentToken.current === tableToken) { setHold(false); setError(data.error ?? "無法送出訂單，請確認後再試"); }
          return;
        }
        throw new Error("unknown outcome");
      }
      if (data?.ok !== true || typeof data.orderId !== "string" || !data.orderId) throw new Error("unknown outcome");
      if (localStorage.getItem(holdKey) !== marker || localStorage.getItem(cartKey) !== saved) {
        // A distinct key cannot overwrite a later request's marker. Persist
        // the confirmed-but-needing-review result even if another tab removed
        // the original hold while this response was in flight.
        const reviewKey = `${holdKey}:review:${marker.slice("pending:".length)}`;
        localStorage.setItem(reviewKey, "confirmed-review");
        if (localStorage.getItem(reviewKey) !== "confirmed-review") throw new Error("storage unavailable");
        if (currentToken.current === tableToken) {
          setHold(true);
          setError("這筆訂單已送出，但購物車或待確認狀態已在其他分頁變更；請向店員核對，暫勿再次送出。");
        }
        return;
      }
      localStorage.removeItem(cartKey);
      if (localStorage.getItem(cartKey) !== null) throw new Error("storage unavailable");
      if (localStorage.getItem(holdKey) !== marker) throw new Error("hold changed");
      localStorage.removeItem(holdKey);
      if (localStorage.getItem(holdKey) !== null) throw new Error("storage unavailable");
      if (currentToken.current === tableToken) router.push(`/order/${tableToken}/success?orderId=${data.orderId}`);
    } catch {
      if (currentToken.current === tableToken) {
        setHold(true);
        setError("訂單可能已送出，請勿再次送出，請向店員確認。");
      }
    } finally {
      inFlight.current = false;
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
        {(hold || error) && <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          <p>{error ?? "訂單可能已送出，請勿再次送出，請向店員確認。"}</p>
          {hold && <p className="mt-2">重新整理後此畫面無法還原送出時的整體備註（包括過敏資訊）；請店員核查原訂單及廚房，勿以此畫面備註為準。</p>}
          {hold && <button type="button" disabled={submitting || !currentStorageReady} onClick={releaseAfterStaffCheck}
            className="mt-3 rounded-lg border border-red-400 bg-white px-3 py-2 disabled:opacity-50">請店員核對後解除</button>}
        </div>}
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
                    <button type="button" disabled={hold || submitting || !currentStorageReady} onClick={() => removeItem(idx)} className="text-red-400 ml-3 disabled:opacity-50">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <div className="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-1">
                      <button type="button" disabled={hold || submitting || !currentStorageReady} onClick={() => changeQty(idx, -1)}><Minus className="h-4 w-4 text-gray-600" /></button>
                      <span className="font-bold w-5 text-center text-sm">{ci.quantity}</span>
                      <button type="button" disabled={hold || submitting || !currentStorageReady} onClick={() => changeQty(idx, 1)}><Plus className="h-4 w-4 text-gray-600" /></button>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="rounded-xl bg-white border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-700 mb-2">整體備註</p>
              <textarea
                value={notes}
                disabled={hold || submitting || !currentStorageReady}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="有特殊需求請備註"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

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
            disabled={submitting || hold || !currentStorageReady}
            className="w-full rounded-xl bg-amber-600 py-4 font-bold text-white text-lg disabled:opacity-60"
          >
            {submitting ? "送出中…" : "確認送出訂單"}
          </button>
        </div>
      )}
    </main>
  );
}
