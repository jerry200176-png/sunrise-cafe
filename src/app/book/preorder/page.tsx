"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { MenuPicker } from "@/components/MenuPicker";
import { selectionProblem, type RuleOption } from "@/lib/option-sets";
import type { MenuItem } from "@/types";
import type { DraftItemInput } from "@/lib/reservation-preorder";

type Item = { id: string; name: string; description?: string | null; price: number; options?: (RuleOption & { option_name: string; price_delta: number })[] };
type Row = DraftItemInput;

function PreorderContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const id = params.get("id") ?? "";
  const [data, setData] = useState<{ reservation: { customer_name: string; start_time: string }; menu: Item[]; preorder?: { draft_items?: Row[]; status?: string } | null; editable: boolean } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id || !token) { setLoading(false); setMessage("缺少訂位驗證連結"); return; }
    fetch(`/api/reservation-preorders/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`)
      .then(async (res) => { const json = await res.json(); if (!res.ok) throw new Error(json.error); setData(json); setRows(json.preorder?.draft_items ?? []); setNotes(json.preorder?.guest_notes ?? ""); })
      .catch((error) => setMessage(error instanceof Error ? error.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [id, token]);

  const total = useMemo(() => rows.reduce((sum, row) => {
    const item = data?.menu.find((candidate) => candidate.id === row.menu_item_id);
    const options = (item?.options ?? []).filter((option) => (row.option_ids ?? []).includes(option.id));
    return sum + ((Number(item?.price) || 0) + options.reduce((n, option) => n + Number(option.price_delta), 0)) * row.quantity;
  }, 0), [data, rows]);

  const problem = data ? selectionProblem(data.menu, rows) : null;

  async function submit() {
    if (!data?.editable) return;
    setSubmitting(true); setMessage(null);
    try {
      const key = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const res = await fetch(`/api/reservation-preorders/${encodeURIComponent(id)}/submit`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ token, items: rows, guest_notes: notes, idempotency_key: key }) });
      const json = await res.json(); if (!res.ok) throw new Error(json.error);
      setData((current) => current ? { ...current, editable: false, preorder: json.preorder } : current);
      setMessage("已送出提前預製餐點，店家將依訂位準備。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "送出失敗"); }
    finally { setSubmitting(false); }
  }

  if (loading) return <main className="mx-auto max-w-lg p-6 text-center">載入中…</main>;
  return <main className="mx-auto max-w-lg p-4 pb-12">
    <div className="mb-4"><Link href="/book/query" className="text-sm text-amber-700">← 返回訂位管理</Link><h1 className="mt-3 text-2xl font-bold">提前選擇預製餐點</h1>{data?.reservation && <p className="mt-1 text-sm text-gray-600">{data.reservation.customer_name} · {new Date(data.reservation.start_time).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>}</div>
    {message && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    {!data ? null : data.menu.length === 0 ? <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">目前沒有可提前預製的餐點，或已超過截止時間。</p> : <>
      <MenuPicker items={data.menu as unknown as MenuItem[]} value={rows} onChange={setRows} disabled={!data.editable || submitting} />
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="給店家的整體備註（選填）" className="mt-4 min-h-20 w-full rounded-lg border p-3 text-sm" />
      <div className="mt-4 flex items-center justify-between rounded-lg bg-amber-50 p-3"><span className="text-sm text-amber-900">預估金額（V1 不線上付款）</span><strong>NT${total}</strong></div>
      {problem && <p role="alert" className="mt-3 text-sm text-rose-700">{problem}</p>}
      <button type="button" onClick={submit} disabled={!data.editable || submitting || Boolean(problem)} className="mt-4 w-full rounded-lg bg-amber-600 py-3 font-semibold text-white disabled:opacity-50">{submitting ? "送出中…" : data.editable ? "確認送出預製餐點" : "已送出／已鎖定"}</button>
    </>}
  </main>;
}

export default function ReservationPreorderPage() { return <Suspense fallback={<main className="p-6 text-center">載入中…</main>}><PreorderContent /></Suspense>; }
