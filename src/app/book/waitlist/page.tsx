"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { taipeiDateString, taipeiDatePlusDays } from "@/lib/datetime";

interface Branch { id: string; name: string; }
interface Room { id: string; name: string; branch_id: string; }

const PENDING_WAITLIST_KEY = "sunrise.waitlist.pending.v1";

function clearPendingWaitlist() {
  sessionStorage.removeItem(PENDING_WAITLIST_KEY);
  if (sessionStorage.getItem(PENDING_WAITLIST_KEY)) throw new Error("storage unavailable");
}

export default function WaitlistPage() {
  const { t } = useLocale();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [branchId, setBranchId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState(false);
  const [branchRetry, setBranchRetry] = useState(0);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState(false);
  const [roomsBranchId, setRoomsBranchId] = useState("");
  const [roomRetry, setRoomRetry] = useState(0);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("12:00");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try { if (sessionStorage.getItem(PENDING_WAITLIST_KEY)) setUncertain(true); }
    catch { setUncertain(true); }
    const params = new URLSearchParams(window.location.search);
    const b = params.get("branchId");
    const r = params.get("roomId");
    const d = params.get("date");
    const s = params.get("start");
    const e = params.get("end");
    if (b) setBranchId(b);
    if (b && r) setRoomId(r);
    if (d) setDate(d);
    if (s) setStartTime(s);
    if (e) setEndTime(e);
    setInitialized(true);
  }, []);

  useEffect(() => {
    let current = true;
    setBranchesLoading(true);
    setBranchesError(false);
    fetchWithTimeout("/api/branches")
      .then(async (response) => {
        if (!response.ok) throw new Error("branches unavailable");
        const data: unknown = await readJsonWithTimeout(response);
        if (!Array.isArray(data) || !data.every((item) => item && typeof item.id === "string" && typeof item.name === "string")) throw new Error("invalid branches");
        return data as Branch[];
      })
      .then((data) => { if (current) setBranches(data); })
      .catch(() => { if (current) { setBranches([]); setBranchesError(true); } })
      .finally(() => { if (current) setBranchesLoading(false); });
    return () => { current = false; };
  }, [branchRetry]);

  useEffect(() => {
    if (!initialized) return;
    if (!branchId) { setRooms([]); setRoomId(""); setRoomsBranchId(""); setRoomsLoading(false); setRoomsError(false); return; }
    let current = true;
    setRooms([]);
    setRoomsBranchId("");
    setRoomsLoading(true);
    setRoomsError(false);
    fetchWithTimeout(`/api/rooms?branchId=${encodeURIComponent(branchId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("rooms unavailable");
        const data: unknown = await readJsonWithTimeout(response);
        if (!Array.isArray(data) || !data.every((item) => item && typeof item.id === "string" && typeof item.name === "string" && item.branch_id === branchId)) throw new Error("invalid rooms");
        return data as Room[];
      })
      .then((data) => {
        if (!current) return;
        setRooms(data);
        setRoomsBranchId(branchId);
        setRoomId((selected) => data.some((room) => room.id === selected) ? selected : "");
      })
      .catch(() => { if (current) { setRooms([]); setRoomId(""); setRoomsError(true); } })
      .finally(() => { if (current) setRoomsLoading(false); });
    return () => { current = false; };
  }, [initialized, branchId, roomRetry]);

  const validSelection = !branchesLoading && !branchesError && branches.some((branch) => branch.id === branchId)
    && !roomsLoading && !roomsError && roomsBranchId === branchId && rooms.some((room) => room.id === roomId);

  const toISO = (d: string, t: string) => `${d}T${t}:00+08:00`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || uncertain || submitting) return;
    if (!validSelection || !date || !name || !phone) {
      setError(t("waitlist.errorFillAll")); return;
    }
    if (startTime >= endTime) {
      setError(t("waitlist.errorEndAfterStart")); return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      try {
        sessionStorage.setItem(PENDING_WAITLIST_KEY, "1");
        if (sessionStorage.getItem(PENDING_WAITLIST_KEY) !== "1") throw new Error("storage unavailable");
      } catch {
        setError(t("waitlist.storageError"));
        return;
      }
      const res = await fetchWithTimeout("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch_id: branchId,
          room_id: roomId,
          start_time: toISO(date, startTime),
          end_time: toISO(date, endTime),
          customer_name: name,
          phone,
        }),
      });
      const data = await readJsonWithTimeout<{ ok?: unknown; error?: unknown }>(res);
      if (!res.ok && [400, 404, 409, 410, 422].includes(res.status) && typeof data?.error === "string") {
        clearPendingWaitlist();
        setError(data.error);
        return;
      }
      if (!res.ok || data?.ok !== true) throw new Error("unknown waitlist outcome");
      clearPendingWaitlist();
      window.location.href = "/book/waitlist/success";
    } catch {
      setUncertain(true);
      setError(null);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const today = taipeiDateString();
  const maxDate = taipeiDatePlusDays(30);

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
              onChange={(e) => {
                setRoomId(""); setRooms([]); setRoomsBranchId("");
                setRoomsLoading(Boolean(e.target.value)); setRoomsError(false);
                setBranchId(e.target.value);
              }}
              disabled={branchesLoading || branchesError || submitting}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              required
            >
              <option value="">{t("waitlist.branchPlaceholder")}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {branchesError && <p role="alert" className="mt-1 text-sm text-red-700">{t("waitlist.branchesError")} <button type="button" className="underline" onClick={() => setBranchRetry((n) => n + 1)}>{t("common.retry")}</button></p>}
          </div>

          <div>
            <label htmlFor="waitlist-room" className="mb-1 block text-sm font-medium text-gray-700">{t("waitlist.room")}</label>
            <select
              id="waitlist-room"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              disabled={!branchId || roomsLoading || roomsError || roomsBranchId !== branchId || submitting}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-gray-50"
              required
            >
              <option value="">{t("waitlist.roomPlaceholder")}</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {roomsLoading && <p role="status" className="mt-1 text-sm text-gray-600">{t("waitlist.roomsLoading")}</p>}
            {roomsError && <p role="alert" className="mt-1 text-sm text-red-700">{t("waitlist.roomsError")} <button type="button" className="underline" onClick={() => setRoomRetry((n) => n + 1)}>{t("common.retry")}</button></p>}
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

          {uncertain && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>{t("waitlist.uncertain")}</p>
            <button type="button" className="mt-2 underline" onClick={() => {
              if (!window.confirm(t("waitlist.uncertainConfirm"))) return;
              try { clearPendingWaitlist(); setUncertain(false); setError(null); }
              catch { setError(t("waitlist.storageError")); }
            }}>{t("waitlist.checkedWithStore")}</button>
          </div>}

          <button
            type="submit"
            disabled={submitting || uncertain || !validSelection}
            className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {submitting ? t("waitlist.submitting") : t("waitlist.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
