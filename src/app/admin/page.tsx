"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Pencil, Trash2, MapPin, LogOut } from "lucide-react";
import type { Branch, Room } from "@/types";
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
  const [roomCapacity, setRoomCapacity] = useState(4);
  const [roomPriceWeekday, setRoomPriceWeekday] = useState(0);
  const [roomPriceWeekend, setRoomPriceWeekend] = useState(0);

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
        const id = (d as { current_branch_id?: string | null })?.current_branch_id;
        if (id) setReservationBranchId(id);
      })
      .catch(() => {});
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
    setRoomCapacity(4);
    setRoomPriceWeekday(0);
    setRoomPriceWeekend(0);
    setRoomFormOpen(true);
  };

  const openEditRoom = (r: Room) => {
    setEditingRoom(r);
    setRoomName(r.name);
    setRoomType(r.type ?? "");
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
          body: JSON.stringify({ name: roomName.trim(), type: roomType.trim() || null, capacity: roomCapacity, price_weekday: roomPriceWeekday, price_weekend: roomPriceWeekend }),
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

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <p className="text-gray-500">載入中…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-600 hover:text-gray-900" aria-label="返回首頁">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-gray-900">後台管理</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/dashboard"
              className="rounded-lg border border-amber-600 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
            >
              儀表板
            </Link>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/admin/logout", { method: "POST" });
                window.location.href = "/admin/login";
              }}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <LogOut className="h-4 w-4" /> 登出
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 space-y-8">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">分店</h2>
            <button
              type="button"
              onClick={openAddBranch}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              <Plus className="h-4 w-4" /> 新增分店
            </button>
          </div>
          {branches.length === 0 ? (
            <p className="text-gray-500 text-sm">尚無分店，請新增。</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {branches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0">
                  <div>
                    <p className="font-medium text-gray-900">{b.name}</p>
                    <p className="text-sm text-gray-500 flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {b.address || "—"} · {b.phone || "—"}
                    </p>
                    <p className="text-xs text-gray-400">
                      營業時間 {formatTime(b.open_time)} ~ {formatTime(b.close_time)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => openEditBranch(b)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => deleteBranch(b.id)} className="rounded-lg border border-red-200 px-2 py-1.5 text-sm text-red-700 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">包廂</h2>
              <select
                value={selectedBranchId ?? ""}
                onChange={(e) => setSelectedBranchId(e.target.value || null)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">請選擇分店</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            {selectedBranchId && (
              <button
                type="button"
                onClick={openAddRoom}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                <Plus className="h-4 w-4" /> 新增包廂
              </button>
            )}
          </div>
          {!selectedBranchId ? (
            <p className="text-gray-500 text-sm">請先選擇分店以管理包廂。</p>
          ) : rooms.length === 0 ? (
            <p className="text-gray-500 text-sm">此分店尚無包廂，請新增。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-600">
                    <th className="pb-2 pr-2">名稱</th>
                    <th className="pb-2 pr-2">類型</th>
                    <th className="pb-2 pr-2">人數</th>
                    <th className="pb-2 pr-2">每小時價格（平日 / 假日）</th>
                    <th className="pb-2 w-24">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100">
                      <td className="py-2 pr-2 font-medium">{r.name}</td>
                      <td className="py-2 pr-2">{r.type || "—"}</td>
                      <td className="py-2 pr-2">{r.capacity} 人</td>
                      <td className="py-2 pr-2">${Number(r.price_weekday)} / ${Number(r.price_weekend)}</td>
                      <td className="py-2 flex gap-1">
                        <button type="button" onClick={() => openEditRoom(r)} className="rounded border border-gray-300 p-1 text-gray-600 hover:bg-gray-50">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => deleteRoom(r.id)} className="rounded border border-red-200 p-1 text-red-600 hover:bg-red-50">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-gray-900">訂位管理</h2>
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
                  }).catch(() => {});
                }}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setAddFormOpen(true)}
                disabled={!reservationBranchId}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> 新增訂位
              </button>
            </div>
          </div>
          <ReservationList branchId={reservationBranchId} rooms={roomsForReservations} />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">{editingBranch ? "編輯分店" : "新增分店"}</h3>
            <form onSubmit={submitBranch} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名稱 *</label>
                <input type="text" required value={branchName} onChange={(e) => setBranchName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="例：嘉義民雄店" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">地址</label>
                <input type="text" value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="例：嘉義縣民雄鄉..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">電話</label>
                <input type="text" value={branchPhone} onChange={(e) => setBranchPhone(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="例：05-1234567" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">營業開始</label>
                  <input type="time" value={branchOpenTime} onChange={(e) => setBranchOpenTime(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">營業結束</label>
                  <input type="time" value={branchCloseTime} onChange={(e) => setBranchCloseTime(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setBranchFormOpen(false)} className="flex-1 rounded-lg border border-gray-300 py-2 text-gray-700 hover:bg-gray-50">取消</button>
                <button type="submit" className="flex-1 rounded-lg bg-amber-600 py-2 text-white hover:bg-amber-700">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {roomFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">{editingRoom ? "編輯包廂" : "新增包廂"}</h3>
            <form onSubmit={submitRoom} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名稱 *</label>
                <input type="text" required value={roomName} onChange={(e) => setRoomName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="例：A包廂、B會議室" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">類型</label>
                <input type="text" value={roomType} onChange={(e) => setRoomType(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="例：會議室、一般包廂" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">容納人數 *</label>
                <input type="number" min={1} required value={roomCapacity} onChange={(e) => setRoomCapacity(Number(e.target.value) || 1)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">平日每小時價格 *</label>
                  <input type="number" min={0} step={1} required value={roomPriceWeekday} onChange={(e) => setRoomPriceWeekday(Number(e.target.value) || 0)} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="200" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">假日每小時價格 *</label>
                  <input type="number" min={0} step={1} required value={roomPriceWeekend} onChange={(e) => setRoomPriceWeekend(Number(e.target.value) || 0)} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="300" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setRoomFormOpen(false)} className="flex-1 rounded-lg border border-gray-300 py-2 text-gray-700 hover:bg-gray-50">取消</button>
                <button type="submit" className="flex-1 rounded-lg bg-amber-600 py-2 text-white hover:bg-amber-700">儲存</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
