"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, QrCode, Printer, LogOut } from "lucide-react";
import type { Table } from "@/types";
import { responseError, thrownMessage } from "@/lib/friendly-error";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { useAdminBranches } from "@/lib/use-admin-branches";
import { ToastStack, type ToastItem, type ToastVariant } from "@/components/Toast";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

const TABLE_WRITE_HOLD = "sunrise.table-write.pending.v1";
type TableSnapshot = { number: string; is_active: boolean };
type TableWriteSummary =
  | { kind: "create"; number: string }
  | { kind: "update"; tableId: string; before: TableSnapshot; after: TableSnapshot };
type TableWriteHold = { branchId: string; operationId: string; summary: TableWriteSummary };
function isSnapshot(value: unknown): value is TableSnapshot {
  return Boolean(value && typeof value === "object" && "number" in value && "is_active" in value &&
    typeof value.number === "string" && typeof value.is_active === "boolean");
}
function readWriteHold(): TableWriteHold | null {
  const value = sessionStorage.getItem(TABLE_WRITE_HOLD);
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || !("branchId" in parsed) || !("operationId" in parsed) || !("summary" in parsed) ||
      typeof parsed.branchId !== "string" || !parsed.branchId || typeof parsed.operationId !== "string" || !parsed.operationId) throw new Error("invalid hold");
  const summary = parsed.summary;
  if (!summary || typeof summary !== "object" || !("kind" in summary)) throw new Error("invalid summary");
  if (summary.kind === "create" && "number" in summary && typeof summary.number === "string" && summary.number) {
    return { branchId: parsed.branchId, operationId: parsed.operationId, summary: { kind: "create", number: summary.number } };
  }
  if (summary.kind === "update" && "tableId" in summary && typeof summary.tableId === "string" && summary.tableId &&
      "before" in summary && "after" in summary && isSnapshot(summary.before) && isSnapshot(summary.after)) {
    return { branchId: parsed.branchId, operationId: parsed.operationId, summary: {
      kind: "update", tableId: summary.tableId,
      before: { number: summary.before.number, is_active: summary.before.is_active },
      after: { number: summary.after.number, is_active: summary.after.is_active },
    } };
  }
  throw new Error("invalid summary");
}
function storeWriteHold(branchId: string, summary: TableWriteSummary) {
  if (sessionStorage.getItem(TABLE_WRITE_HOLD) !== null) throw new Error("existing hold");
  const operationId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const value = JSON.stringify({ branchId, operationId, summary });
  sessionStorage.setItem(TABLE_WRITE_HOLD, value);
  if (sessionStorage.getItem(TABLE_WRITE_HOLD) !== value) throw new Error("storage unavailable");
  return operationId;
}
function clearWriteHold(operationId: string | null) {
  if ((readWriteHold()?.operationId ?? null) !== operationId) throw new Error("hold changed");
  sessionStorage.removeItem(TABLE_WRITE_HOLD);
  if (sessionStorage.getItem(TABLE_WRITE_HOLD)) throw new Error("storage unavailable");
}

export default function AdminTablesPage() {
  const { branches, loading: branchesLoading, error: branchesError, retry: retryBranches } = useAdminBranches();
  const [branchId, setBranchId] = useState("");
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newNumber, setNewNumber] = useState("");
  const [qrMap, setQrMap] = useState<Record<string, { qr_data_url: string; order_url: string }>>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);
  const requestSequence = useRef(0);
  const activeBranchId = useRef(branchId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNumber, setEditNumber] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [writeUncertain, setWriteUncertain] = useState(false);
  const [pendingSummary, setPendingSummary] = useState<TableWriteSummary | null>(null);
  const [verifiedBranch, setVerifiedBranch] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const writeInFlight = useRef(false);
  const pendingBranch = useRef<string | null>(null);
  const reviewedOperation = useRef<string | null>(null);
  const canAttemptReview = Boolean(pendingSummary && pendingBranch.current &&
    !branchesLoading && !branchesError && branchId === pendingBranch.current &&
    branches.some((branch) => branch.id === branchId));
  const canViewPendingSummary = canAttemptReview && verifiedBranch === branchId;

  const showToast = (message: string, variant: ToastVariant = "info") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
  };

  const lockForStorageFailure = () => {
    try {
      const pending = readWriteHold();
      if (pending) { pendingBranch.current = pending.branchId; setPendingSummary(pending.summary); }
    } catch { pendingBranch.current = "unavailable"; }
    if (pendingBranch.current && pendingBranch.current !== activeBranchId.current) {
      requestSequence.current++;
      activeBranchId.current = "";
      setBranchId(""); setTables([]); setError(null); setLoading(false);
    }
    setWriteUncertain(true);
    setReviewed(false);
    showToast("無法安全保存操作狀態，尚未送出請求；請檢查待確認操作及瀏覽器儲存功能。", "error");
  };

  useEffect(() => {
    try {
      const pending = readWriteHold();
      if (pending) {
        pendingBranch.current = pending.branchId;
        setPendingSummary(pending.summary);
        setWriteUncertain(true);
      }
    } catch {
      pendingBranch.current = "unavailable";
      setWriteUncertain(true);
    }
  }, []);

  useEffect(() => {
    if (!branchId && branches.length > 0) {
      const preferred = pendingBranch.current;
      const selected = preferred ? branches.find((branch) => branch.id === preferred) : branches[0];
      if (selected) { activeBranchId.current = selected.id; setBranchId(selected.id); }
    }
    else if (branchId && !branches.some((branch) => branch.id === branchId)) {
      requestSequence.current++;
      activeBranchId.current = "";
      setBranchId(""); setTables([]); setError(null); setLoading(false);
    }
  }, [branches, branchId]);

  const loadTables = async (bid: string) => {
    if (bid !== activeBranchId.current) return false;
    const current = ++requestSequence.current;
    setVerifiedBranch(null);
    setReviewed(false);
    if (!bid) { setTables([]); setLoading(false); return false; }
    setLoading(true); setError(null);
    try {
      const res = await fetchWithTimeout(`/api/admin/tables?branchId=${encodeURIComponent(bid)}`, { credentials: "include" });
      if (!res.ok) throw new Error(await responseError(res));
      const data = await readJsonWithTimeout<Table[]>(res);
      if (!Array.isArray(data) || data.some((table) => !table || typeof table.id !== "string" ||
          typeof table.number !== "string" || typeof table.is_active !== "boolean" || table.branch_id !== bid)) {
        throw new Error("桌位資料格式不正確，請重試");
      }
      if (current !== requestSequence.current || bid !== activeBranchId.current) return false;
      setTables(data);
      setVerifiedBranch(bid);
      return true;
    } catch (cause) {
      if (current === requestSequence.current && bid === activeBranchId.current) { setTables([]); setError(thrownMessage(cause, "桌位載入失敗，請重試")); }
      return false;
    } finally {
      if (current === requestSequence.current) setLoading(false);
    }
  };

  useEffect(() => { void loadTables(branchId); }, [branchId]);

  const addTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNumber.trim() || writeInFlight.current || writeUncertain || !branchId) return;
    const requestedBranch = branchId;
    const requestedNumber = newNumber.trim();
    if (tables.some((table) => table.number === requestedNumber) && !window.confirm("此分店已有相同桌號，兩張桌位的 QR 不同。確定仍要新增？")) return;
    writeInFlight.current = true;
    setSavingId("new");
    try {
      let operationId: string;
      try {
        const summary: TableWriteSummary = { kind: "create", number: requestedNumber };
        operationId = storeWriteHold(requestedBranch, summary); pendingBranch.current = requestedBranch; setPendingSummary(summary);
      }
      catch { lockForStorageFailure(); return; }
      const res = await fetchWithTimeout("/api/admin/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: requestedBranch, number: requestedNumber }),
      });
      const data = await readJsonWithTimeout<{ id?: unknown; number?: unknown; branch_id?: unknown; error?: unknown }>(res);
      if (!res.ok) {
        if ([400, 401, 403, 404, 409].includes(res.status)) {
          clearWriteHold(operationId); pendingBranch.current = null; setPendingSummary(null);
          showToast(typeof data?.error === "string" ? data.error : "新增桌位失敗", "error");
          return;
        }
        throw new Error("unknown outcome");
      }
      if (typeof data?.id !== "string" || data.number !== requestedNumber || data.branch_id !== requestedBranch) throw new Error("unknown outcome");
      clearWriteHold(operationId); pendingBranch.current = null; setPendingSummary(null);
      if (activeBranchId.current !== requestedBranch) return;
      setNewNumber("");
      showToast(`已新增桌號 ${requestedNumber}`, "success");
      await loadTables(requestedBranch);
    } catch {
      setWriteUncertain(true); setReviewed(false);
      showToast("新增結果尚未確認，請先重新整理並核對桌位。", "error");
    } finally {
      writeInFlight.current = false;
      setSavingId(null);
    }
  };

  const loadQr = async (table: Table) => {
    if (qrMap[table.id]) return;
    const requestedBranch = activeBranchId.current;
    try {
      const res = await fetchWithTimeout(`/api/admin/tables/${table.id}/qr`, { credentials: "include" });
      if (!res.ok) throw new Error(await responseError(res));
      const data = await readJsonWithTimeout<{ qr_data_url: string; order_url: string }>(res);
      if (requestedBranch !== activeBranchId.current) return;
      if (typeof data?.qr_data_url !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.qr_data_url) || typeof data.order_url !== "string") throw new Error("QR 資料格式不正確，請重試");
      setQrMap(prev => ({ ...prev, [table.id]: data }));
    } catch (cause) { if (requestedBranch === activeBranchId.current) showToast(thrownMessage(cause, "QR 載入失敗，請重試"), "error"); }
  };

  const updateTable = async (table: Table, changes: { number?: string; is_active?: boolean }) => {
    if (writeInFlight.current || writeUncertain || table.branch_id !== activeBranchId.current) return;
    writeInFlight.current = true;
    setSavingId(table.id);
    try {
      let operationId: string;
      try {
        const summary: TableWriteSummary = {
          kind: "update", tableId: table.id,
          before: { number: table.number, is_active: table.is_active },
          after: { number: changes.number ?? table.number, is_active: changes.is_active ?? table.is_active },
        };
        operationId = storeWriteHold(table.branch_id, summary); pendingBranch.current = table.branch_id; setPendingSummary(summary);
      }
      catch { lockForStorageFailure(); return; }
      const res = await fetchWithTimeout(`/api/admin/tables/${encodeURIComponent(table.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected: { number: table.number, is_active: table.is_active }, ...changes }),
      });
      const data = await readJsonWithTimeout<{ id?: unknown; number?: unknown; is_active?: unknown; error?: unknown }>(res);
      if (!res.ok) {
        if ([400, 401, 403, 404, 409].includes(res.status)) {
          clearWriteHold(operationId); pendingBranch.current = null; setPendingSummary(null);
          showToast(typeof data?.error === "string" ? data.error : "桌位更新失敗，請重新整理", "error");
          if (res.status === 409) { setEditingId(null); await loadTables(table.branch_id); }
          return;
        }
        throw new Error("unknown outcome");
      }
      if (data?.id !== table.id || typeof data.number !== "string" || typeof data.is_active !== "boolean" ||
          (changes.number !== undefined && data.number !== changes.number) ||
          (changes.is_active !== undefined && data.is_active !== changes.is_active)) throw new Error("unknown outcome");
      clearWriteHold(operationId); pendingBranch.current = null; setPendingSummary(null);
      if (activeBranchId.current !== table.branch_id) return;
      setTables((current) => current.map((row) => row.id === table.id ? { ...row, number: data.number as string, is_active: data.is_active as boolean } : row));
      setEditingId(null);
      showToast(changes.is_active === false ? "桌位已停用" : changes.is_active === true ? "桌位已啟用" : "桌號已更新", "success");
    } catch {
      setWriteUncertain(true);
      setReviewed(false);
      showToast("更新結果尚未確認，請先重新整理並核對桌位。", "error");
    } finally {
      writeInFlight.current = false;
      setSavingId(null);
    }
  };

  const reviewTables = async () => {
    if (!canAttemptReview) return;
    setReviewed(false);
    try {
      const before = readWriteHold();
      if (before && before.branchId !== branchId) throw new Error("wrong branch");
      const operationId = before?.operationId ?? null;
      const ok = await loadTables(branchId);
      if (ok && (readWriteHold()?.operationId ?? null) === operationId) {
        reviewedOperation.current = operationId;
        setReviewed(true);
      }
    } catch {
      showToast("無法確認待處理操作，請檢查瀏覽器儲存功能。", "error");
    }
  };

  const printQr = (table: Table) => {
    const entry = qrMap[table.id];
    if (!entry) return;
    const w = window.open("", "_blank");
    if (!w) {
      showToast("瀏覽器阻擋彈出視窗，請允許後再試", "error");
      return;
    }
    w.document.write(`
      <html><body style="text-align:center;font-family:sans-serif;padding:40px">
        <h2>桌號 ${escapeHtml(table.number)}</h2>
        <img src="${entry.qr_data_url}" style="width:240px" alt="桌 ${escapeHtml(table.number)} QR"/>
        <p style="font-size:14px;color:#666">用手機掃描點餐</p>
        <script>window.onload=()=>window.print()</script>
      </body></html>
    `);
    w.document.close();
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900" aria-label="返回後台首頁">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-lg font-bold text-gray-900">桌位管理</h1>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="tables-branch" className="sr-only">選擇分店</label>
            <select id="tables-branch" value={branchId} disabled={savingId !== null || writeUncertain} onChange={e => {
              if (writeInFlight.current || writeUncertain) return;
              const nextBranchId = e.target.value;
              requestSequence.current++;
              activeBranchId.current = nextBranchId;
              setTables([]); setQrMap({}); setEditingId(null); setError(null); setLoading(Boolean(nextBranchId));
              setBranchId(nextBranchId);
            }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px]">
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button type="button" onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); window.location.href = "/admin/login"; }} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50" aria-label="登出">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {writeUncertain && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>桌位操作結果尚未確認，原請求可能稍後完成。請重新整理並核對桌號與狀態後，再決定是否操作。</p>
          {canViewPendingSummary && pendingSummary?.kind === "create" && <p className="mt-2">待核對：新增桌號 {pendingSummary.number}。相同桌號可能有多張不同 QR；請核對清單中的完整桌位識別碼，無法自動判定哪筆由這次請求建立。</p>}
          {canViewPendingSummary && pendingSummary?.kind === "update" && <div className="mt-2"><p className="break-all">待核對桌位識別碼：{pendingSummary.tableId}</p><p>原本：桌號 {pendingSummary.before.number}／{pendingSummary.before.is_active ? "使用中" : "已停用"}</p><p>預期：桌號 {pendingSummary.after.number}／{pendingSummary.after.is_active ? "使用中" : "已停用"}</p></div>}
          {!pendingSummary && <p className="mt-2">無法讀取原操作摘要，請聯絡管理員確認後再處理。</p>}
          {pendingSummary && !canViewPendingSummary && <p className="mt-2">尚無法確認原分店的存取權限及完整桌位清單。</p>}
          {!branchId && <p>無法載入原操作分店；請聯絡管理員確認桌位後再處理。</p>}
          <button type="button" className="mt-2 min-h-[44px] rounded-lg border border-amber-700 px-3" disabled={loading || savingId !== null || !canAttemptReview} onClick={() => void reviewTables()}>重新整理並核對</button>
          {reviewed && canViewPendingSummary && <button type="button" className="ml-2 mt-2 min-h-[44px] rounded-lg border border-amber-700 px-3" onClick={() => { if (window.confirm("原請求仍可能稍後完成。已核對桌位並了解再次操作的風險嗎？")) { try { clearWriteHold(reviewedOperation.current); pendingBranch.current = null; setPendingSummary(null); setWriteUncertain(false); setReviewed(false); } catch { setReviewed(false); showToast("待確認操作已改變或無法保存，請重新整理並核對。", "error"); } } }}>已核對，允許操作</button>}
        </div>}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">新增桌位</h2>
          <form onSubmit={addTable} className="flex gap-2">
            <input type="text" required maxLength={40} value={newNumber} disabled={savingId !== null || writeUncertain} onChange={e => setNewNumber(e.target.value)} placeholder="桌號，例：A1、B3" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px]" />
            <button type="submit" disabled={!branchId || branchesLoading || loading || Boolean(error) || savingId !== null || writeUncertain} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              <Plus className="h-4 w-4" /> 新增
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">桌位列表</h2>
      {branchesError && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{branchesError}</span><button type="button" onClick={() => void retryBranches()} disabled={branchesLoading} className="min-h-[44px] rounded-lg border border-red-300 bg-white px-3 disabled:opacity-50">重試分店</button></div>}
      {branchesLoading && <p role="status" className="text-sm text-gray-500">載入分店中…</p>}
      {!branchesLoading && !branchesError && branches.length === 0 && <p role="status" className="rounded-lg bg-stone-100 px-4 py-3 text-sm text-stone-600">目前沒有可管理的分店。</p>}
      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{error}</span><button type="button" onClick={() => void loadTables(branchId)} disabled={!branchId || loading} className="min-h-[44px] rounded-lg border border-red-300 bg-white px-3 disabled:opacity-50">重試</button></div>}
      {branchId && loading ? <p role="status" className="text-sm text-gray-500">載入桌位中…</p> : error || !branchId || branchesLoading || branchesError || !branches.some((branch) => branch.id === branchId) || verifiedBranch !== branchId ? null : tables.length === 0 ? (
            <p className="text-sm text-gray-500">尚無桌位</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {tables.map(table => {
                const duplicate = tables.some((other) => other.id !== table.id && other.number === table.number);
                const identity = duplicate ? `，識別碼 ${table.id}` : "";
                return (
                <div key={table.id} className="py-3 first:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900">桌號 {table.number}</p>
                      <p className={`text-xs ${table.is_active ? "text-emerald-700" : "text-amber-800"}`}>{table.is_active ? "使用中" : "已停用"}</p>
                      {(duplicate || writeUncertain) && <p className="break-all text-xs text-gray-500">桌位識別碼 {table.id}</p>}
                      {duplicate && <p className="text-xs text-amber-800">此分店有相同桌號，請以識別碼核對。</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={savingId !== null || writeUncertain} onClick={() => { setEditingId(table.id); setEditNumber(table.number); }} className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm disabled:opacity-50" aria-label={`編輯桌號 ${table.number}${identity}`}>編輯</button>
                      <button type="button" disabled={savingId !== null || writeUncertain} onClick={() => {
                        if (table.is_active && !window.confirm("停用後此 QR 無法開始新的點餐；已在途的訂單仍可能完成，既有訂單及 QR 會保留。確定停用？")) return;
                        void updateTable(table, { is_active: !table.is_active });
                      }} className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm disabled:opacity-50" aria-label={`${table.is_active ? "停用" : "啟用"}桌號 ${table.number}${identity}`}>{table.is_active ? "停用" : "啟用"}</button>
                      <button type="button" disabled={savingId !== null || writeUncertain} onClick={() => loadQr(table)} aria-label={duplicate ? `顯示桌號 ${table.number} QR${identity}` : undefined} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        <QrCode className="h-4 w-4" aria-hidden /> 顯示 QR
                      </button>
                      {qrMap[table.id] && table.is_active && (
                        <button type="button" disabled={savingId !== null || writeUncertain} onClick={() => printQr(table)} aria-label={duplicate ? `列印桌號 ${table.number} QR${identity}` : undefined} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50">
                          <Printer className="h-4 w-4" aria-hidden /> 列印
                        </button>
                      )}
                    </div>
                  </div>
                  {editingId === table.id && <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
                    event.preventDefault();
                    const next = editNumber.trim();
                    if (!next || next === table.number) { setEditingId(null); return; }
                    const duplicate = tables.some((other) => other.id !== table.id && other.number === next);
                    if (!window.confirm(`${duplicate ? "此分店已有相同桌號，兩張桌位的 QR 不同。" : ""}更改桌號會改變既有訂單畫面顯示的桌號；QR 和訂單資料會保留。確定更改？`)) return;
                    void updateTable(table, { number: next });
                  }}>
                    <label htmlFor={`table-number-${table.id}`} className="sr-only">新桌號</label>
                    <input id={`table-number-${table.id}`} required maxLength={40} value={editNumber} disabled={savingId !== null || writeUncertain} onChange={(event) => setEditNumber(event.target.value)} className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm" />
                    <button type="submit" disabled={savingId !== null || writeUncertain} className="min-h-[44px] rounded-lg bg-amber-600 px-3 text-sm text-white disabled:opacity-50">儲存桌號</button>
                    <button type="button" disabled={savingId !== null} onClick={() => setEditingId(null)} className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm disabled:opacity-50">取消</button>
                  </form>}
                  {qrMap[table.id] && (
                    <div className="mt-3 flex items-center gap-4">
                      {/* eslint-disable-next-line @next/next/no-img-element -- data URL from QR API */}
                      <img src={qrMap[table.id].qr_data_url} alt={`桌 ${table.number} QR 碼`} className="h-24 w-24 rounded border border-gray-200" />
                      <p className="text-xs text-gray-500">{table.is_active ? "客人用手機掃描就能點餐" : "桌位停用中，此 QR 暫時無法點餐；重新啟用後可繼續使用。"}</p>
                    </div>
                  )}
                </div>
              ); })}
            </div>
          )}
        </section>
      </div>
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
    </main>
  );
}
