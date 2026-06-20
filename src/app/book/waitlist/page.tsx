"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface Branch { id: string; name: string; }
interface Room { id: string; name: string; }

export default function WaitlistPage() {
  const { t } = useLocale();
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
      setError(t("waitlist.errorFillAll")); return;
    }
    if (startTime >= endTime) {
      setError(t("waitlist.errorEndAfterStart")); return;
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
      if (!res.ok) { setError(data.error ?? t("waitlist.errorJoinFailed")); return; }
      window.location.href = "/book/waitlist/success";
    } catch {
      setError(t("waitlist.errorNetwork"));
    } finally {
      setSubmitting(false);
    }
  };

  const today = new Date().toISOString().split("T")[0];
  const maxDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  return (
    <div className="min-h-screen bg-amber-50 px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-2 flex items-center justify-between">
          <Link href="/book" className="flex items-center gap-2 text-sm text-amber-700 hover:text-amber-900">
            <ArrowLeft size={16} /> {t("waitlist.backToBooking")}
          </Link>
          <LanguageSwitcher />
        </div>

        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-full bg-amber-100 p-2">
            <Clock size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">{t("waitlist.headerTitle")}</h1>
            <p className="text-sm text-gray-500">{t("waitlist.headerDesc")}</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="waitlist-branch" className="mb-1 block text-sm font-medium text-gray-700">{t("waitlist.branch")}</label>
            <select
              id="waitlist-branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              required
            >
              <option value="">{t("waitlist.branchPlaceholder")}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="waitlist-room" className="mb-1 block text-sm font-medium text-gray-700">{t("waitlist.room")}</label>
            <select
              id="waitlist-room"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              disabled={!branchId}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-gray-50"
              required
            >
              <option value="">{t("waitlist.roomPlaceholder")}</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="waitlist-date" className="mb-1 block text-sm font-medium text-gray-700">{t("waitlist.date")}</label>
            <input
              id="waitlist-date"
              type="date" value={date} min={today} max={maxDate}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              required
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="waitlist-start-time" className="mb-1 block text-sm font-medium text-gray-700">{t("waitlist.startTime")}</label>
              <input
                id="waitlist-start-time"
                type="time" value={startTime} min="08:00" max="21:00" step="1800"
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                required
              />
            </div>
            <div className="flex-1">
              <label htmlFor="waitlist-end-time" className="mb-1 block text-sm font-medium text-gray-700">{t("waitlist.endTime")}</label>
              <input
                id="waitlist-end-time"
                type="time" value={endTime} min="10:00" max="22:00" step="1800"
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="waitlist-name" className="mb-1 block text-sm font-medium text-gray-700">{t("waitlist.name")}</label>
            <input
              id="waitlist-name"
              type="text" value={name} placeholder={t("waitlist.namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              required
            />
          </div>

          <div>
            <label htmlFor="waitlist-phone" className="mb-1 block text-sm font-medium text-gray-700">{t("waitlist.phone")}</label>
            <input
              id="waitlist-phone"
              type="tel" value={phone} placeholder={t("waitlist.phonePlaceholder")}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              required
            />
            <p className="mt-1 text-xs text-gray-400">{t("waitlist.phoneHint")}</p>
          </div>

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {submitting ? t("waitlist.submitting") : t("waitlist.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
