"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, QrCode, Printer, LogOut } from "lucide-react";
import type { Branch, Table } from "@/types";
import { responseError, thrownMessage } from "@/lib/friendly-error";
import { ToastStack, type ToastItem, type ToastVariant } from "@/components/Toast";

export default function AdminTablesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [tables, setTables] = useState<Table[]>([]);
  const [newNumber, setNewNumber] = useState("");
  const [qrMap, setQrMap] = useState<Record<string, { qr_data_url: string; order_url: string }>>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const showToast = (message: string, variant: ToastVariant = "info") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
  };

  useEffect(() => {
    fetch("/api/branches").then(r => r.json()).then(d => {
      const list = Array.isArray(d) ? d : [];
      setBranches(list);
      if (list.length > 0) setBranchId(list[0].id);
    });
  }, []);

  const loadTables = async (bid: string) => {
    if (!bid) return;
    const res = await fetch(`/api/admin/tables?branchId=${encodeURIComponent(bid)}`);
    const data = await res.json();
    setTables(Array.isArray(data) ? data : []);
  };

  useEffect(() => { if (branchId) loadTables(branchId); }, [branchId]);

  const addTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNumber.trim()) return;
    try {
      const res = await fetch("/api/admin/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: branchId, number: newNumber.trim() }),
      });
      if (!res.ok) {
        showToast(await responseError(res), "error");
        return;
      }
      showToast(`已新增桌號 ${newNumber.trim()}`, "success");
    } catch (err) {
      showToast(thrownMessage(err), "error");
      return;
    }
    setNewNumber("");
    loadTables(branchId);
  };

  const loadQr = async (table: Table) => {
    if (qrMap[table.id]) return;
    const res = await fetch(`/api/admin/tables/${table.id}/qr`);
    const data = await res.json();
    setQrMap(prev => ({ ...prev, [table.id]: data }));
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
        <h2>桌號 ${table.number}</h2>
        <img src="${entry.qr_data_url}" style="width:240px" alt="桌 ${table.number} QR"/>
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
            <select id="tables-branch" value={branchId} onChange={e => setBranchId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px]">
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button type="button" onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); window.location.href = "/admin/login"; }} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50" aria-label="登出">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">新增桌位</h2>
          <form onSubmit={addTable} className="flex gap-2">
            <input type="text" required value={newNumber} onChange={e => setNewNumber(e.target.value)} placeholder="桌號，例：A1、B3" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px]" />
            <button type="submit" className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700">
              <Plus className="h-4 w-4" /> 新增
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">桌位列表</h2>
          {tables.length === 0 ? (
            <p className="text-sm text-gray-500">尚無桌位</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {tables.map(table => (
                <div key={table.id} className="py-3 first:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900">桌號 {table.number}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => loadQr(table)} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        <QrCode className="h-4 w-4" aria-hidden /> 顯示 QR
                      </button>
                      {qrMap[table.id] && (
                        <button type="button" onClick={() => printQr(table)} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-700">
                          <Printer className="h-4 w-4" aria-hidden /> 列印
                        </button>
                      )}
                    </div>
                  </div>
                  {qrMap[table.id] && (
                    <div className="mt-3 flex items-center gap-4">
                      {/* eslint-disable-next-line @next/next/no-img-element -- data URL from QR API */}
                      <img src={qrMap[table.id].qr_data_url} alt={`桌 ${table.number} QR 碼`} className="h-24 w-24 rounded border border-gray-200" />
                      <p className="text-xs text-gray-500">客人用手機掃描就能點餐</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
    </main>
  );
}
