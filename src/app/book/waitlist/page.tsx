"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";

interface Branch { id: string; name: string; }
interface Room { id: string; name: string; }

export default function WaitlistPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [branchId, setBranchId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("12:00");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/branches").then((r) => r.json()).then(setBranches);
  }, []);

  useEffect(() => {
    if (!branchId) { setRooms([]); setRoomId(""); return; }
    fetch(`/api/rooms?branchId=${branchId}`).then((r) => r.json()).then(setRooms);
  }, [branchId]);

  const toISO = (d: string, t: string) => `${d}T${t}:00+08:00`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId || !date || !name || !phone) {
      setError("請填寫所有欄位"); return;
    }
    if (startTime >= endTime) {
      setError("結束時間需晚於開始時間"); return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          start_time: toISO(date, startTime),
          end_time: toISO(date, endTime),
          customer_name: name,
          phone,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "無法加入等位"); return; }
      window.location.href = "/book/waitlist/success";
    } catch {
      setError("網路錯誤，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  };

  const today = new Date().toISOString().split("T")[0];
  const maxDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  return (
    <div className="min-h-screen bg-amber-50 px-4 py-8">
      <div className="mx-auto max-w-md">
        <Link href="/book" className="mb-6 flex items-center gap-2 text-sm text-amber-700 hover:text-amber-900">
          <ArrowLeft size={16} /> 返回訂位
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-full bg-amber-100 p-2">
            <Clock size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">加入等位清單</h1>
            <p className="text-sm text-gray-500">有人取消時將優先通知您</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">分店</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              required
            >
              <option value="">請選擇分店</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">包廂</label>
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              disabled={!branchId}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-gray-50"
              required
            >
              <option value="">請選擇包廂</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">希望日期</label>
            <input
              type="date" value={date} min={today} max={maxDate}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              required
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">開始時間</label>
              <input
                type="time" value={startTime} min="08:00" max="21:00" step="1800"
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                required
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">結束時間</label>
              <input
                type="time" value={endTime} min="10:00" max="22:00" step="1800"
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">姓名</label>
            <input
              type="text" value={name} placeholder="您的姓名"
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">手機號碼</label>
            <input
              type="tel" value={phone} placeholder="09xxxxxxxx"
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              required
            />
            <p className="mt-1 text-xs text-gray-400">若您曾使用 LINE 綁定訂位，有空位時將自動傳 LINE 通知給您</p>
          </div>

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {submitting ? "送出中…" : "加入等位清單"}
          </button>
        </form>
      </div>
    </div>
  );
}
