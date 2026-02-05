"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calendar, DollarSign, Users, LogOut } from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import type { Branch } from "@/types";

interface Stats {
  date: string;
  todayCount: number;
  todayRevenue: number;
  roomsInUseCount: number;
  totalRooms: number;
}

interface TimelineRoom {
  roomId: string;
  roomName: string;
  reservations: {
    start_time: string;
    end_time: string;
    customer_name: string;
    status: string;
    total_price: number | null;
  }[];
}

interface TimelineData {
  date: string;
  branchName: string;
  openTime: string;
  closeTime: string;
  rooms: TimelineRoom[];
}

export default function AdminDashboardPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [stats, setStats] = useState<Stats | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        const arr = Array.isArray(d) ? d : [];
        setBranches(arr);
        if (arr.length > 0 && !branchId) setBranchId(arr[0].id);
      })
      .catch(() => setBranches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!branchId) {
      setStats(null);
      setTimeline(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/admin/stats?branchId=${encodeURIComponent(branchId)}&date=${encodeURIComponent(date)}`).then((r) => r.json()),
      fetch(`/api/admin/timeline?branchId=${encodeURIComponent(branchId)}&date=${encodeURIComponent(date)}`).then((r) => r.json()),
    ])
      .then(([statsData, timelineData]) => {
        if (statsData.error) throw new Error(statsData.error);
        if (timelineData.error) throw new Error(timelineData.error);
        setStats(statsData);
        setTimeline(timelineData);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "載入失敗");
        setStats(null);
        setTimeline(null);
      })
      .finally(() => setLoading(false));
  }, [branchId, date]);

  const timeToPercent = (iso: string, dayStart: string, dayEnd: string) => {
    const start = new Date(dayStart).getTime();
    const end = new Date(dayEnd).getTime();
    const t = new Date(iso).getTime();
    return Math.max(0, Math.min(100, ((t - start) / (end - start)) * 100));
  };

  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/admin"
              className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
              aria-label="返回"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-gray-900">儀表板</h1>
          </div>
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
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          >
            <option value="">請選擇分店</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading && (
          <p className="text-gray-500">載入中…</p>
        )}

        {!loading && stats && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <Calendar className="h-5 w-5" />
                  <span className="text-sm">今日總訂位數</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-gray-900">{stats.todayCount}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <Users className="h-5 w-5" />
                  <span className="text-sm">目前使用中包廂</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-gray-900">
                  {stats.roomsInUseCount} / {stats.totalRooms}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <DollarSign className="h-5 w-5" />
                  <span className="text-sm">今日預估營收</span>
                </div>
                <p className="mt-2 text-2xl font-bold text-gray-900">${stats.todayRevenue}</p>
              </div>
            </div>

            {timeline && (
              <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">
                  時間軸 · {timeline.branchName} · {format(parseISO(date), "yyyy/MM/dd (EEE)", { locale: zhTW })}
                </h2>
                <div className="overflow-x-auto">
                  <div className="min-w-[600px] space-y-3">
                    {timeline.rooms.map((room) => (
                      <div key={room.roomId} className="flex items-stretch gap-2">
                        <div className="w-24 shrink-0 py-1 text-sm font-medium text-gray-700">
                          {room.roomName}
                        </div>
                        <div className="relative flex-1 rounded border border-gray-200 bg-gray-50/50 h-10">
                          {room.reservations
                            .filter((r) => r.status !== "cancelled")
                            .map((r) => {
                              const left = timeToPercent(r.start_time, dayStart, dayEnd);
                              const right = timeToPercent(r.end_time, dayStart, dayEnd);
                              const w = Math.max(2, right - left);
                              return (
                                <div
                                  key={`${r.start_time}-${r.end_time}`}
                                  className="absolute top-1 bottom-1 rounded bg-amber-200 px-1 overflow-hidden"
                                  style={{
                                    left: `${left}%`,
                                    width: `${w}%`,
                                    minWidth: "4px",
                                  }}
                                  title={`${r.customer_name} ${format(parseISO(r.start_time), "HH:mm")}-${format(parseISO(r.end_time), "HH:mm")}`}
                                >
                                  <span className="block truncate text-xs text-amber-900">
                                    {r.customer_name} {format(parseISO(r.start_time), "HH:mm")}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  橫軸為當日時間；長條為預約時段（不含已取消）
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
