"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { MenuPicker } from "@/components/MenuPicker";
import { selectionProblem, type RuleOption } from "@/lib/option-sets";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import type { MenuItem } from "@/types";
import type { DraftItemInput } from "@/lib/reservation-preorder";

type Item = { id: string; name: string; description?: string | null; price: number; options?: (RuleOption & { option_name: string; price_delta: number })[] };
type Row = DraftItemInput;
type Preorder = { draft_items?: Row[]; guest_notes?: string | null; status?: string; requires_reconfirmation?: boolean; result?: { already_submitted?: boolean } | null };
type PageData = { reservation: { customer_name: string; start_time: string }; menu: Item[]; preorder?: Preorder | null; editable: boolean };
type Guard = "loading" | "clear" | "pending" | "confirmed" | "unavailable";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guardKey = (id: string) => `sunrise.preorder.pending.v1:${id.toLowerCase()}`;

function validRows(value: unknown): value is Row[] {
  return Array.isArray(value) && value.every((row) => row && typeof row === "object" &&
    typeof row.menu_item_id === "string" && Number.isInteger(row.quantity) && row.quantity > 0 && row.quantity <= 99 &&
    (row.option_ids == null || (Array.isArray(row.option_ids) && row.option_ids.every((item: unknown) => typeof item === "string"))) &&
    (row.special_notes == null || typeof row.special_notes === "string"));
}

function validMenu(value: unknown): value is Item[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" &&
    typeof item.id === "string" && typeof item.name === "string" &&
    (typeof item.price === "number" || typeof item.price === "string") && Number.isFinite(Number(item.price)) &&
    (item.options == null || (Array.isArray(item.options) && item.options.every((option: unknown) => {
      if (!option || typeof option !== "object") return false;
      const row = option as { id?: unknown; option_name?: unknown; option_group?: unknown; price_delta?: unknown };
      return typeof row.id === "string" && typeof row.option_name === "string" && typeof row.option_group === "string" &&
        (typeof row.price_delta === "number" || typeof row.price_delta === "string") && Number.isFinite(Number(row.price_delta));
    }))));
}

function PreorderContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const id = params.get("id") ?? "";
  // Token is used only in memory and the authorized request, never in the guard.
  const scope = `${id}\u0000${token}`;
  const activeScopeRef = useRef(scope);
  const scopeVersionRef = useRef(0);
  if (activeScopeRef.current !== scope) {
    activeScopeRef.current = scope;
    scopeVersionRef.current += 1;
  }
  const loadVersionRef = useRef(0);
  const mountedRef = useRef(false);
  const submittingRef = useRef(false);
  const [data, setData] = useState<PageData | null>(null);
  const [dataScope, setDataScope] = useState("");
  const [guard, setGuard] = useState<Guard>("loading");
  const [guardScope, setGuardScope] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const loadVersion = ++loadVersionRef.current;
    const currentLoad = () => active && loadVersionRef.current === loadVersion;
    setData(null); setDataScope(""); setRows([]); setNotes(""); setMessage(null);
    setLoading(true); setLoadError(null); setGuard("loading"); setGuardScope("");
    if (!UUID.test(id) || !token) {
      setLoading(false); setLoadError("訂位驗證連結不完整，請返回訂位管理重新查詢。");
      return () => { active = false; };
    }
    try {
      const previous = sessionStorage.getItem(guardKey(id));
      setGuard(previous === null ? "clear" : previous === "confirmed" ? "confirmed" : previous === "pending" ? "pending" : "unavailable");
    } catch { setGuard("unavailable"); }
    setGuardScope(scope);
    void (async () => {
      try {
        const res = await fetchWithTimeout(`/api/reservation-preorders/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`);
        const value = await readJsonWithTimeout<unknown>(res);
        if (!res.ok || !value || typeof value !== "object") throw new Error("load failed");
        const received = value as Partial<PageData>;
        if (!received.reservation || typeof received.reservation.customer_name !== "string" ||
            typeof received.reservation.start_time !== "string" || Number.isNaN(Date.parse(received.reservation.start_time)) ||
            !validMenu(received.menu) || typeof received.editable !== "boolean" ||
            (received.preorder != null && (typeof received.preorder !== "object" ||
              (received.preorder.draft_items !== undefined && !validRows(received.preorder.draft_items)) ||
              (received.preorder.guest_notes != null && typeof received.preorder.guest_notes !== "string") ||
              (received.preorder.requires_reconfirmation != null && typeof received.preorder.requires_reconfirmation !== "boolean")))) throw new Error("invalid response");
        if (!currentLoad()) return;
        const page = received as PageData;
        setData(page); setDataScope(scope);
        setRows(page.preorder?.draft_items ?? []); setNotes(page.preorder?.guest_notes ?? "");
      } catch {
        if (currentLoad()) setLoadError("無法載入提前選餐，請稍後重試或返回訂位管理查詢。");
      } finally { if (currentLoad()) setLoading(false); }
    })();
    return () => { active = false; };
  }, [id, token, scope, retry]);

  const total = useMemo(() => rows.reduce((sum, row) => {
    const item = data?.menu.find((candidate) => candidate.id === row.menu_item_id);
    const options = (item?.options ?? []).filter((option) => (row.option_ids ?? []).includes(option.id));
    return sum + ((Number(item?.price) || 0) + options.reduce((n, option) => n + Number(option.price_delta), 0)) * row.quantity;
  }, 0), [data, rows]);

  const problem = data ? selectionProblem(data.menu, rows) : null;
  const activeGuard = guardScope === scope ? guard : "loading";
  const canEdit = dataScope === scope && Boolean(data?.editable) && activeGuard === "clear" && !submitting;
  const canSubmit = canEdit && !problem;

  async function submit() {
    if (submittingRef.current || !canSubmit || !UUID.test(id)) return;
    submittingRef.current = true;
    const submissionVersion = scopeVersionRef.current;
    const currentSubmission = () => mountedRef.current && activeScopeRef.current === scope && scopeVersionRef.current === submissionVersion;
    setSubmitting(true); setMessage(null);
    try {
      // Serialize before the guard: a local error cannot have submitted anything.
      const key = crypto.randomUUID();
      const body = JSON.stringify({ token, items: rows, guest_notes: notes, idempotency_key: key });
      try {
        if (sessionStorage.getItem(guardKey(id)) !== null) {
          if (currentSubmission()) setGuard("pending");
          return;
        }
        sessionStorage.setItem(guardKey(id), "pending");
        if (sessionStorage.getItem(guardKey(id)) !== "pending") throw new Error("storage unavailable");
      } catch {
        if (currentSubmission()) setGuard("unavailable");
        return;
      }
      if (currentSubmission()) setGuard("pending");
      // A read begun before this submission must not overwrite its eventual result.
      loadVersionRef.current += 1;
      const res = await fetchWithTimeout(`/api/reservation-preorders/${encodeURIComponent(id)}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body,
      });
      const value = await readJsonWithTimeout<unknown>(res);
      // The API can report 400/409 after the RPC committed; all failed or
      // incomplete responses remain unknown and must not release the guard.
      if (!res.ok || !value || typeof value !== "object") throw new Error("unknown outcome");
      const result = value as { ok?: unknown; preorder?: Preorder | null };
      if (result.ok !== true || !result.preorder || !["submitted", "locked"].includes(result.preorder.status ?? "") ||
          !validRows(result.preorder.draft_items) ||
          (result.preorder.guest_notes != null && typeof result.preorder.guest_notes !== "string") ||
          (result.preorder.requires_reconfirmation != null && typeof result.preorder.requires_reconfirmation !== "boolean") ||
          (result.preorder.result != null && typeof result.preorder.result.already_submitted !== "boolean")) throw new Error("unknown outcome");
      if (!currentSubmission()) return;
      // Keep the confirmed flag for this tab; returning/reloading cannot retry
      // an already submitted operation. The stored value contains no token/items.
      try {
        sessionStorage.setItem(guardKey(id), "confirmed");
        if (sessionStorage.getItem(guardKey(id)) !== "confirmed") throw new Error("storage unavailable");
        setGuard("confirmed");
      } catch { setGuard("pending"); }
      setData((current) => current ? { ...current, editable: false, preorder: result.preorder } : current);
      setRows(result.preorder.draft_items);
      setNotes(result.preorder.guest_notes ?? "");
      setMessage(result.preorder.requires_reconfirmation === true
        ? "訂位或餐點已變更，仍需要重新確認。先前的送出紀錄不代表此次變更已確認，請聯絡店家。"
        : result.preorder.result?.already_submitted !== false
          ? "此訂位已有送出的餐點，剛才的新選擇未必已套用。此畫面未必列出所有已送出的餐點，請聯絡店家核對。"
          : "已送出提前預製餐點，店家將依訂位準備。需要變更請聯絡店家。");
    } catch {
      // If a local pre-dispatch error occurred no guard exists; a stored pending
      // flag means the request may have committed, even for an HTTP error.
      if (currentSubmission()) {
        try {
          if (sessionStorage.getItem(guardKey(id)) === "pending") setGuard("pending");
          else setMessage("目前無法送出，請稍後再試。");
        } catch { setGuard("unavailable"); }
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }

  const showData = dataScope === scope ? data : null;
  const needsReconfirmation = showData?.preorder?.requires_reconfirmation === true ||
    (activeGuard === "confirmed" && showData?.editable === true);
  return <main className="mx-auto max-w-lg p-4 pb-12">
    <div className="mb-4"><Link href="/book/query" className="text-sm text-amber-700">← 返回訂位管理</Link><h1 className="mt-3 text-2xl font-bold">提前選擇預製餐點</h1>{showData?.reservation && <p className="mt-1 text-sm text-gray-600">{showData.reservation.customer_name} · {new Date(showData.reservation.start_time).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>}</div>
    {loading && <p role="status">載入中…</p>}
    {loadError && <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{loadError}{UUID.test(id) && token && <button type="button" className="ml-2 underline" onClick={() => setRetry((value) => value + 1)}>重新載入</button>}</div>}
    {message && <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    {activeGuard === "pending" && !submitting && !message && <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">提前選餐的結果尚未確認，請勿再次送出。請先查詢訂位，若查不到或仍不確定，請聯絡店家確認；原請求可能稍後完成。 <Link className="underline" href="/book/query">前往訂位管理</Link></div>}
    {activeGuard === "unavailable" && <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">無法安全記錄本分頁的送出狀態，已暫停線上送出；請查詢訂位或聯絡店家。 <Link className="underline" href="/book/query">前往訂位管理</Link></div>}
    {needsReconfirmation && <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">訂位或餐點可能已變更，需要重新確認；先前的送出不代表變更已確認，請聯絡店家。</p>}
    {activeGuard === "confirmed" && !message && !needsReconfirmation && <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">本分頁先前已確認有提前選餐紀錄；需要變更請聯絡店家。</p>}
    {!showData ? null : showData.menu.length === 0 ? <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">目前沒有可提前預製的餐點，或已超過截止時間。</p> : <>
      {!canEdit && <p className="mb-3 text-sm text-amber-900">以下僅供參考，可能未列出所有已送出的餐點與選項；請向店家核對。</p>}
      <MenuPicker items={showData.menu as unknown as MenuItem[]} value={rows} onChange={setRows} disabled={!canEdit} showPrices={canEdit} />
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!canEdit} maxLength={1000} placeholder="給店家的整體備註（選填）" className="mt-4 min-h-20 w-full rounded-lg border p-3 text-sm disabled:opacity-50" />
      {canEdit ? <div className="mt-4 flex items-center justify-between rounded-lg bg-amber-50 p-3"><span className="text-sm text-amber-900">預估金額（V1 不線上付款）</span><strong>NT${total}</strong></div> : <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">已送出或待確認的餐點與實際金額，請向店家核對。</p>}
      {problem && <p role="alert" className="mt-3 text-sm text-rose-700">{problem}</p>}
      <button type="button" onClick={submit} disabled={!canSubmit} className="mt-4 w-full rounded-lg bg-amber-600 py-3 font-semibold text-white disabled:opacity-50">{submitting ? "送出中…" : showData.editable ? "確認送出預製餐點" : "已送出／已鎖定"}</button>
    </>}
  </main>;
}

export default function ReservationPreorderPage() { return <Suspense fallback={<main className="p-6 text-center">載入中…</main>}><PreorderContent /></Suspense>; }
