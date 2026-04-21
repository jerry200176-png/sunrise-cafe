"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Plus, Pencil, Trash2, MapPin, LogOut, ChefHat, UtensilsCrossed, QrCode, Printer, Building2, LayoutGrid, ClipboardList, CalendarDays } from "lucide-react";
import type { Branch, Room, RentalNoteSection } from "@/types";
import { BranchSwitcher } from "@/components/BranchSwitcher";
import { ReservationList } from "@/components/ReservationList";
import { AddReservationForm } from "@/components/AddReservationForm";

export default function AdminBranchesRoomsPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [reservationBranchId, setReservationBranchId] = useState<string | null>(null);
  const [roomsForReservations, setRoomsForReservations] = useState<Room[]>([]);
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [branchFormOpen, setBranchFormOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [branchPhone, setBranchPhone] = useState("");
  const [branchOpenTime, setBranchOpenTime] = useState("09:00");
  const [branchCloseTime, setBranchCloseTime] = useState("21:00");

  const [roomFormOpen, setRoomFormOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomName, setRoomName] = useState("");
  const [roomType, setRoomType] = useState("");
  const [roomMinCapacity, setRoomMinCapacity] = useState(1);
  const [roomCapacity, setRoomCapacity] = useState(4);
  const [roomPriceWeekday, setRoomPriceWeekday] = useState(0);
  const [roomPriceWeekend, setRoomPriceWeekend] = useState(0);

  const [rentalNotes, setRentalNotes] = useState<RentalNoteSection[]>([]);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  const loadBranches = async () => {
    const res = await fetch("/api/branches");
    const data = await res.json();
    if (res.ok) setBranches(Array.isArray(data) ? data : []);
  };

  const loadRooms = async () => {
    if (!selectedBranchId) {
      setRooms([]);
      return;
    }
    const res = await fetch(`/api/rooms?branchId=${encodeURIComponent(selectedBranchId)}`);
    const data = await res.json();
    if (res.ok) setRooms(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    setError(null);
    (async () => {
      try {
        await loadBranches();
      } catch (e) {
        setError(e instanceof Error ? e.message : "載入失敗");
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    loadRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId]);

  useEffect(() => {
    if (!reservationBranchId) {
      setRoomsForReservations([]);
      return;
    }
    fetch(`/api/rooms?branchId=${encodeURIComponent(reservationBranchId)}`)
      .then((r) => r.json())
      .then((d) => setRoomsForReservations(Array.isArray(d) ? d : []))
      .catch(() => setRoomsForReservations([]));
  }, [reservationBranchId]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        const data = d as { current_branch_id?: string | null; rental_notes?: RentalNoteSection[] };
        if (data?.current_branch_id) setReservationBranchId(data.current_branch_id);
        if (Array.isArray(data?.rental_notes)) setRentalNotes(data.rental_notes);
      })
      .catch(() => { });
  }, []);

  const openAddBranch = () => {
    setEditingBranch(null);
    setBranchName("");
    setBranchAddress("");
    setBranchPhone("");
    setBranchOpenTime("09:00");
    setBranchCloseTime("21:00");
    setBranchFormOpen(true);
  };

  const openEditBranch = (b: Branch) => {
    setEditingBranch(b);
    setBranchName(b.name);
    setBranchAddress(b.address ?? "");
    setBranchPhone(b.phone ?? "");
    setBranchOpenTime(b.open_time ?? "09:00");
    setBranchCloseTime(b.close_time ?? "21:00");
    setBranchFormOpen(true);
  };

  const submitBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingBranch) {
        const res = await fetch(`/api/branches/${editingBranch.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: branchName.trim(),
            address: branchAddress.trim() || null,
            phone: branchPhone.trim() || null,
            open_time: branchOpenTime || null,
            close_time: branchCloseTime || null,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "更新失敗");
      } else {
        const res = await fetch("/api/branches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: branchName.trim(),
            address: branchAddress.trim() || null,
            phone: branchPhone.trim() || null,
            open_time: branchOpenTime || null,
            close_time: branchCloseTime || null,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "新增失敗");
      }
      setBranchFormOpen(false);
      loadBranches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗");
    }
  };

  const deleteBranch = async (id: string) => {
    if (!confirm("確定要刪除此分店嗎？底下的包廂與預約也會一併刪除。")) return;
    try {
      const res = await fetch(`/api/branches/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "刪除失敗");
      if (selectedBranchId === id) setSelectedBranchId(null);
      loadBranches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除失敗");
    }
  };

  const openAddRoom = () => {
    if (!selectedBranchId) return;
    setEditingRoom(null);
    setRoomName("");
    setRoomType("");
    setRoomMinCapacity(1);
    setRoomCapacity(4);
    setRoomPriceWeekday(0);
    setRoomPriceWeekend(0);
    setRoomFormOpen(true);
  };

  const openEditRoom = (r: Room) => {
    setEditingRoom(r);
    setRoomName(r.name);
    setRoomType(r.type ?? "");
    setRoomMinCapacity(r.min_capacity ?? 1);
    setRoomCapacity(r.capacity);
    setRoomPriceWeekday(Number(r.price_weekday));
    setRoomPriceWeekend(Number(r.price_weekend));
    setRoomFormOpen(true);
  };

  const submitRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranchId) return;
    try {
      if (editingRoom) {
        const res = await fetch(`/api/rooms/${editingRoom.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: roomName.trim(), type: roomType.trim() || null, min_capacity: roomMinCapacity, capacity: roomCapacity, price_weekday: roomPriceWeekday, price_weekend: roomPriceWeekend }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "更新失敗");
      } else {
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch_id: selectedBranchId,
            name: roomName.trim(),
            type: roomType.trim() || null,
            min_capacity: roomMinCapacity,
            capacity: roomCapacity,
            price_weekday: roomPriceWeekday,
            price_weekend: roomPriceWeekend,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "新增失敗");
      }
      setRoomFormOpen(false);
      loadRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗");
    }
  };

  const deleteRoom = async (id: string) => {
    if (!confirm("確定要刪除此包廂嗎？")) return;
    try {
      const res = await fetch(`/api/rooms/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "刪除失敗");
      loadRooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除失敗");
    }
  };

  const formatTime = (t: string | null) => (t ? String(t).slice(0, 5) : "—");

  const saveRentalNotes = async () => {
    setNotesSaving(true);
    setNotesSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rental_notes: rentalNotes }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "儲存失敗");
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setNotesSaving(false);
    }
  };

  const updateSectionTitle = (si: number, title: string) =>
    setRentalNotes((prev) => prev.map((s, i) => i === si ? { ...s, title } : s));

  const updateSectionItem = (si: number, ii: number, value: string) =>
    setRentalNotes((prev) => prev.map((s, i) =>
      i === si ? { ...s, items: s.items.map((item, j) => j === ii ? value : item) } : s
    ));

  const addSectionItem = (si: number) =>
    setRentalNotes((prev) => prev.map((s, i) =>
      i === si ? { ...s, items: [...s.items, ""] } : s
    ));

  const removeSectionItem = (si: number, ii: number) =>
    setRentalNotes((prev) => prev.map((s, i) =>
      i === si ? { ...s, items: s.items.filter((_, j) => j !== ii) } : s
    ));

  const addSection = () =>
    setRentalNotes((prev) => [...prev, { title: "", items: [""] }]);

  const removeSection = (si: number) =>
    setRentalNotes((prev) => prev.filter((_, i) => i !== si));

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <p className="text-gray-500">載入中…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <Link href="/" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600" aria-label="返回首頁">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-2.5">
              <div className="relative h-8 w-8">
                <Image src="/logo.webp" alt="昇咖啡" fill className="object-contain" />
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-wide text-stone-800">後台管理</h1>
                <p className="text-[10px] tracking-widest text-stone-400 uppercase">Admin Panel</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/dashboard"
              className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100 transition-colors"
            >
              儀表板
            </Link>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/admin/logout", { method: "POST" });
                window.location.href = "/admin/login";
              }}
              className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 transition-colors"
            >
              <LogOut className="h-4 w-4" /> 登出
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">

        {/* 點餐系統快速入口 */}
        <section className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50/30 p-4">
          <p className="mb-3 text-xs font-semibold tracking-widest text-amber-700 uppercase">自助點餐系統</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { href: "/admin/orders", icon: ChefHat, label: "即時訂單" },
              { href: "/admin/menu", icon: UtensilsCrossed, label: "菜單管理" },
              { href: "/admin/tables", icon: QrCode, label: "桌位 QR" },
              { href: "/admin/print-station", icon: Printer, label: "列印站" },
            ].map(({ href, icon: Icon, label }) => (
              <Link key={href} href={href}
                className="flex flex-col items-center gap-2 rounded-xl bg-white/80 border border-amber-100 p-3.5 text-sm font-medium text-stone-700 shadow-sm hover:border-amber-300 hover:bg-white hover:shadow-md transition-all"
              >
                <Icon className="h-6 w-6 text-amber-600" />
                {label}
              </Link>
            ))}
          </div>
        </section>

        {error && (
          <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            <span className="shrink-0 text-base">⚠️</span>
            {error}
          </div>
        )}

        {/* 分店管理 */}
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50/50 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <Building2 className="h-4 w-4 text-blue-500" />
              <h2 className="text-sm font-semibold tracking-wide text-stone-700">分店管理</h2>
            </div>
            <button
              type="button"
              onClick={openAddBranch}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> 新增分店
            </button>
          </div>
          <div className="p-4">
          {branches.length === 0 ? (
            <p className="text-sm text-stone-400 py-2">尚無分店，請新增。</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {branches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0">
                  <div>
                    <p className="font-medium text-stone-800">{b.name}</p>
                    <p className="text-sm text-stone-500 flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {b.address || "—"} · {b.phone || "—"}
                    </p>
                    <p className="text-xs text-stone-400 mt-0.5">
                      營業時間 {formatTime(b.open_time)} ~ {formatTime(b.close_time)}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => openEditBranch(b)} title="編輯"
                      className="rounded-lg border border-stone-200 p-2 text-stone-500 hover:bg-stone-50 hover:text-stone-700 transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => deleteBranch(b.id)} title="刪除"
                      className="rounded-lg border border-red-100 p-2 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          </div>
        </section>

        {/* 包廂管理 */}
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/50 px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold tracking-wide text-stone-700">包廂管理</h2>
              </div>
              <select
                value={selectedBranchId ?? ""}
                onChange={(e) => setSelectedBranchId(e.target.value || null)}
                className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700 focus:border-amber-400 focus:outline-none"
              >
                <option value="">選擇分店</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            {selectedBranchId && (
              <button type="button" onClick={openAddRoom}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors">
                <Plus className="h-3.5 w-3.5" /> 新增包廂
              </button>
            )}
          </div>
          <div className="p-4">
          {!selectedBranchId ? (
            <p className="py-2 text-sm text-stone-400">請先選擇分店以管理包廂。</p>
          ) : rooms.length === 0 ? (
            <p className="py-2 text-sm text-stone-400">此分店尚無包廂，請新增。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-xs font-semibold tracking-wide text-stone-400 uppercase">
                    <th className="pb-2.5 pr-3">名稱</th>
                    <th className="pb-2.5 pr-3">類型</th>
                    <th className="pb-2.5 pr-3">人數</th>
                    <th className="pb-2.5 pr-3">平日 / 假日（每小時）</th>
                    <th className="pb-2.5 w-20">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((r, idx) => (
                    <tr key={r.id} className={`border-b border-stone-50 ${idx % 2 === 0 ? "" : "bg-stone-50/40"}`}>
                      <td className="py-2.5 pr-3 font-medium text-stone-800">{r.name}</td>
                      <td className="py-2.5 pr-3 text-stone-500">{r.type || "—"}</td>
                      <td className="py-2.5 pr-3 text-stone-500">{r.min_capacity && r.min_capacity < r.capacity ? `${r.min_capacity}–${r.capacity}` : r.capacity} 人</td>
                      <td className="py-2.5 pr-3 text-stone-500">${Number(r.price_weekday)} / ${Number(r.price_weekend)}</td>
                      <td className="py-2.5">
                        <div className="flex gap-1">
                          <button type="button" onClick={() => openEditRoom(r)} title="編輯"
                            className="rounded border border-stone-200 p-1.5 text-stone-500 hover:bg-stone-50 transition-colors">
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button type="button" onClick={() => deleteRoom(r.id)} title="刪除"
                            className="rounded border border-red-100 p-1.5 text-red-400 hover:bg-red-50 transition-colors">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </section>

        {/* 包廂租借注意事項 */}
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/50 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-emerald-500" />
              <h2 className="text-sm font-semibold tracking-wide text-stone-700">包廂租借注意事項</h2>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={addSection}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50 transition-colors">
                <Plus className="h-3.5 w-3.5" /> 新增段落
              </button>
              <button type="button" onClick={saveRentalNotes} disabled={notesSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors">
                {notesSaving ? "儲存中…" : notesSaved ? "✓ 已儲存" : "儲存"}
              </button>
            </div>
          </div>
          <div className="p-4">
          {rentalNotes.length === 0 ? (
            <p className="py-2 text-sm text-stone-400">尚無注意事項。點擊「新增段落」開始編輯。</p>
          ) : (
            <div className="space-y-3">
              {rentalNotes.map((section, si) => (
                <div key={si} className="rounded-xl border border-stone-100 bg-stone-50/50 p-3">
                  <div className="flex items-center gap-2 mb-2.5">
                    <input type="text" value={section.title}
                      onChange={(e) => updateSectionTitle(si, e.target.value)}
                      placeholder="段落標題（例：💰 費用說明）"
                      className="flex-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-800 focus:border-amber-400 focus:outline-none"
                    />
                    <button type="button" onClick={() => removeSection(si)} title="刪除此段落"
                      className="rounded-lg border border-red-100 p-1.5 text-red-400 hover:bg-red-50 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1.5 pl-1">
                    {section.items.map((item, ii) => (
                      <div key={ii} className="flex items-center gap-2">
                        <span className="text-amber-400 text-sm">•</span>
                        <input type="text" value={item}
                          onChange={(e) => updateSectionItem(si, ii, e.target.value)}
                          placeholder="條目內容"
                          className="flex-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-sm focus:border-amber-400 focus:outline-none"
                        />
                        <button type="button" onClick={() => removeSectionItem(si, ii)} title="刪除此條目"
                          className="rounded border border-red-100 p-1 text-red-300 hover:bg-red-50 transition-colors">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => addSectionItem(si)}
                      className="mt-1 text-xs text-amber-600 hover:text-amber-800 transition-colors">
                      + 新增條目
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </section>

        {/* 訂位管理 */}
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/50 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-violet-500" />
              <h2 className="text-sm font-semibold tracking-wide text-stone-700">訂位管理</h2>
            </div>
            <div className="flex items-center gap-2">
              <BranchSwitcher
                branches={branches}
                currentBranchId={reservationBranchId}
                onBranchChange={(id) => {
                  setReservationBranchId(id);
                  fetch("/api/settings", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ current_branch_id: id }),
                  }).catch(() => { });
                }}
                disabled={loading}
              />
              <button type="button" onClick={() => setAddFormOpen(true)} disabled={!reservationBranchId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors">
                <Plus className="h-3.5 w-3.5" /> 新增訂位
              </button>
            </div>
          </div>
          <div className="p-4">
            <ReservationList branchId={reservationBranchId} rooms={roomsForReservations} />
          </div>
        </section>
      </div>

      <AddReservationForm
        branchId={reservationBranchId}
        rooms={roomsForReservations}
        open={addFormOpen}
        onClose={() => setAddFormOpen(false)}
        onSuccess={() => setAddFormOpen(false)}
      />

      {branchFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-500" />
              <h3 className="text-base font-semibold text-stone-800">{editingBranch ? "編輯分店" : "新增分店"}</h3>
            </div>
            <form onSubmit={submitBranch} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">名稱 *</label>
                <input type="text" required value={branchName} onChange={(e) => setBranchName(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder="例：嘉義民雄店" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">地址</label>
                <input type="text" value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder="例：嘉義縣民雄鄉..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">電話</label>
                <input type="text" value={branchPhone} onChange={(e) => setBranchPhone(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder="例：05-1234567" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">開始時間</label>
                  <input type="time" value={branchOpenTime} onChange={(e) => setBranchOpenTime(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">結束時間</label>
                  <input type="time" value={branchCloseTime} onChange={(e) => setBranchCloseTime(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setBranchFormOpen(false)} className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm text-stone-600 hover:bg-stone-50 transition-colors">取消</button>
                <button type="submit" className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {roomFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-amber-500" />
              <h3 className="text-base font-semibold text-stone-800">{editingRoom ? "編輯包廂" : "新增包廂"}</h3>
            </div>
            <form onSubmit={submitRoom} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">名稱 *</label>
                <input type="text" required value={roomName} onChange={(e) => setRoomName(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder="例：A包廂、B會議室" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">類型</label>
                <input type="text" value={roomType} onChange={(e) => setRoomType(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder="例：會議室、一般包廂" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">最少人數 *</label>
                  <input type="number" min={1} required value={roomMinCapacity} onChange={(e) => setRoomMinCapacity(Number(e.target.value) || 1)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">最大人數 *</label>
                  <input type="number" min={1} required value={roomCapacity} onChange={(e) => setRoomCapacity(Number(e.target.value) || 1)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">平日每小時 *</label>
                  <input type="number" min={0} step={1} required value={roomPriceWeekday} onChange={(e) => setRoomPriceWeekday(Number(e.target.value) || 0)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder="200" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">假日每小時 *</label>
                  <input type="number" min={0} step={1} required value={roomPriceWeekend} onChange={(e) => setRoomPriceWeekend(Number(e.target.value) || 0)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder="300" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setRoomFormOpen(false)} className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm text-stone-600 hover:bg-stone-50 transition-colors">取消</button>
                <button type="submit" className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
