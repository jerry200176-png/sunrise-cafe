"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, QrCode, Printer, LogOut } from "lucide-react";
import type { Branch, Table } from "@/types";

export default function AdminTablesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [tables, setTables] = useState<Table[]>([]);
  const [newNumber, setNewNumber] = useState("");
  const [qrMap, setQrMap] = useState<Record<string, { qr_data_url: string; order_url: string }>>({});

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
    await fetch("/api/admin/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch_id: branchId, number: newNumber.trim() }),
    });
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
    if (!w) return;
    w.document.write(`
      <html><body style="text-align:center;font-family:sans-serif;padding:40px">
        <h2>桌號 ${table.number}</h2>
        <img src="${entry.qr_data_url}" style="width:240px"/>
        <p style="font-size:12px;color:#666;word-break:break-all">${entry.order_url}</p>
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
            <Link href="/admin" className="text-gray-600 hover:text-gray-900"><ArrowLeft className="h-5 w-5" /></Link>
            <h1 className="text-lg font-bold text-gray-900">桌位管理</h1>
          </div>
          <div className="flex items-center gap-2">
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button type="button" onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); window.location.href = "/admin/login"; }} className="rounded-lg border border-gray-300 p-1.5 text-gray-600"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* 新增桌位 */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">新增桌位</h2>
          <form onSubmit={addTable} className="flex gap-2">
            <input type="text" required value={newNumber} onChange={e => setNewNumber(e.target.value)} placeholder="桌號，例：A1、B3" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button type="submit" className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700">
              <Plus className="h-4 w-4" /> 新增
            </button>
          </form>
        </section>

        {/* 桌位列表 */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">桌位列表</h2>
          {tables.length === 0 ? (
            <p className="text-sm text-gray-500">尚無桌位</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {tables.map(table => (
                <div key={table.id} className="py-3 first:pt-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">桌號 {table.number}</p>
                      <p className="text-xs text-gray-400 font-mono">{table.qr_token}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => loadQr(table)} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                        <QrCode className="h-4 w-4" /> 顯示 QR
                      </button>
                      {qrMap[table.id] && (
                        <button type="button" onClick={() => printQr(table)} className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700">
                          <Printer className="h-4 w-4" /> 列印
                        </button>
                      )}
                    </div>
                  </div>
                  {qrMap[table.id] && (
                    <div className="mt-3 flex items-center gap-4">
                      <img src={qrMap[table.id].qr_data_url} alt={`桌 ${table.number} QR`} className="h-24 w-24 rounded border border-gray-200" />
                      <p className="text-xs text-gray-500 break-all">{qrMap[table.id].order_url}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
