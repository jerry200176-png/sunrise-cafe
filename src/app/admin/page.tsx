"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, MapPin, ChefHat, UtensilsCrossed, QrCode, Printer, Building2, LayoutGrid, ClipboardList, CalendarDays, CalendarX, BarChart2, Star, DollarSign, Activity, Clock, AlertTriangle, LayoutDashboard } from "lucide-react";
import type { Branch, Room, RentalNoteSection } from "@/types";
import { BranchSwitcher } from "@/components/BranchSwitcher";
import { ReservationList } from "@/components/ReservationList";
import { AddReservationForm } from "@/components/AddReservationForm";
import { AdminModal } from "@/components/AdminModal";
import { AdminShell } from "@/components/admin/AdminShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ToastStack, type ToastItem, type ToastVariant } from "@/components/Toast";
import { formatRentalNotesText, parseRentalNotesText } from "@/lib/branch-guest-settings";
import { formRowsToWeekly, weeklyToFormRows, WEEKDAY_LABELS, type WeekdayFormRow } from "@/lib/branch-hours";

export default function AdminBranchesRoomsPage() {
  const [focusBranchId, setFocusBranchId] = useState<string | null>(null);
  const [focusReservationId, setFocusReservationId] = useState<string | null>(null);
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
  const [branchWeeklyEnabled, setBranchWeeklyEnabled] = useState(false);
  const [branchWeeklyRows, setBranchWeeklyRows] = useState<WeekdayFormRow[]>(() => weeklyToFormRows(null, "09:00", "21:00"));
  const [branchLineGroupId, setBranchLineGroupId] = useState("");
  const [branchDisplayName, setBranchDisplayName] = useState("");
  const [branchPaymentInfo, setBranchPaymentInfo] = useState("");
  const [branchLinePayUrl, setBranchLinePayUrl] = useState("");
  const [branchReviewUrl, setBranchReviewUrl] = useState("");
  const [branchDepositInfo, setBranchDepositInfo] = useState("");
  const [branchRentalNotesText, setBranchRentalNotesText] = useState("");

  const [roomFormOpen, setRoomFormOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomName, setRoomName] = useState("");
  const [roomType, setRoomType] = useState("");
  const [roomMinCapacity, setRoomMinCapacity] = useState(1);
  const [roomCapacity, setRoomCapacity] = useState(4);
  const [roomPriceWeekday, setRoomPriceWeekday] = useState(0);
  const [roomPriceWeekend, setRoomPriceWeekend] = useState(0);
  const [roomImageUrl, setRoomImageUrl] = useState("");
  const [roomImageFile, setRoomImageFile] = useState<File | null>(null);

  const [rentalNotes, setRentalNotes] = useState<RentalNoteSection[]>([]);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [closedDateInput, setClosedDateInput] = useState("");
  const [closedDatesSaving, setClosedDatesSaving] = useState(false);
  const [closedDatesSaved, setClosedDatesSaved] = useState(false);

  const [depositInfo, setDepositInfo] = useState("");
  const [depositInfoSaving, setDepositInfoSaving] = useState(false);
  const [depositInfoSaved, setDepositInfoSaved] = useState(false);

  const [googleReviewUrl, setGoogleReviewUrl] = useState("");
  const [googleReviewUrlSaving, setGoogleReviewUrlSaving] = useState(false);
  const [googleReviewUrlSaved, setGoogleReviewUrlSaved] = useState(false);

  const [paymentKeywords, setPaymentKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordsSaving, setKeywordsSaving] = useState(false);
  const [keywordsSaved, setKeywordsSaved] = useState(false);

  const [confirmDeleteBranchId, setConfirmDeleteBranchId] = useState<string | null>(null);
  const [confirmDeleteRoomId, setConfirmDeleteRoomId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFocusBranchId(params.get("branchId"));
    setFocusReservationId(params.get("reservation"));
  }, []);

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
    if (focusBranchId && branches.some((branch) => branch.id === focusBranchId)) {
      setReservationBranchId(focusBranchId);
    }
  }, [branches, focusBranchId]);

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
        const data = d as { current_branch_id?: string | null; rental_notes?: RentalNoteSection[]; closed_dates?: string[]; deposit_info?: string | null; payment_keywords?: string[]; google_review_url?: string | null };
        if (data?.current_branch_id) setReservationBranchId(data.current_branch_id);
        if (Array.isArray(data?.rental_notes)) setRentalNotes(data.rental_notes);
        if (data?.deposit_info) setDepositInfo(data.deposit_info);
        if (Array.isArray(data?.payment_keywords)) setPaymentKeywords(data.payment_keywords);
        if (data?.google_review_url) setGoogleReviewUrl(data.google_review_url);
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (!reservationBranchId) {
      setClosedDates([]);
      return;
    }
    const branch = branches.find((b) => b.id === reservationBranchId);
    setClosedDates(Array.isArray(branch?.closed_dates) ? branch.closed_dates : []);
  }, [reservationBranchId, branches]);

  const openAddBranch = () => {
    setEditingBranch(null);
    setBranchName("");
    setBranchAddress("");
    setBranchPhone("");
    setBranchOpenTime("09:00");
    setBranchCloseTime("21:00");
    setBranchWeeklyEnabled(false);
    setBranchWeeklyRows(weeklyToFormRows(null, "09:00", "21:00"));
    setBranchLineGroupId("");
    setBranchDisplayName("");
    setBranchPaymentInfo("");
    setBranchLinePayUrl("");
    setBranchReviewUrl("");
    setBranchDepositInfo("");
    setBranchRentalNotesText("");
    setBranchFormOpen(true);
  };

  const openEditBranch = (b: Branch) => {
    setEditingBranch(b);
    setBranchName(b.name);
    setBranchAddress(b.address ?? "");
    setBranchPhone(b.phone ?? "");
    setBranchOpenTime(b.open_time ?? "09:00");
    setBranchCloseTime(b.close_time ?? "21:00");
    setBranchWeeklyEnabled(Boolean(b.weekly_hours));
    setBranchWeeklyRows(weeklyToFormRows(b.weekly_hours, b.open_time ?? "09:00", b.close_time ?? "21:00"));
    setBranchLineGroupId(((b as unknown) as Record<string, unknown>).line_group_id as string ?? "");
    const rec = (b as unknown) as Record<string, unknown>;
    setBranchDisplayName((rec.display_name as string) ?? "");
    setBranchPaymentInfo((rec.payment_info as string) ?? "");
    setBranchLinePayUrl((rec.line_pay_url as string) ?? "");
    setBranchReviewUrl(b.google_review_url ?? "");
    setBranchDepositInfo(b.deposit_info ?? "");
    setBranchRentalNotesText(formatRentalNotesText(b.rental_notes));
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
            weekly_hours: branchWeeklyEnabled ? formRowsToWeekly(branchWeeklyRows) : null,
            line_group_id: branchLineGroupId.trim() || null,
            display_name: branchDisplayName.trim() || null,
            payment_info: branchPaymentInfo.trim() || null,
            line_pay_url: branchLinePayUrl.trim() || null,
            google_review_url: branchReviewUrl.trim() || null,
            deposit_info: branchDepositInfo.trim() || null,
            rental_notes: parseRentalNotesText(branchRentalNotesText),
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
            weekly_hours: branchWeeklyEnabled ? formRowsToWeekly(branchWeeklyRows) : null,
            line_group_id: branchLineGroupId.trim() || null,
            display_name: branchDisplayName.trim() || null,
            payment_info: branchPaymentInfo.trim() || null,
            line_pay_url: branchLinePayUrl.trim() || null,
            google_review_url: branchReviewUrl.trim() || null,
            deposit_info: branchDepositInfo.trim() || null,
            rental_notes: parseRentalNotesText(branchRentalNotesText),
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
    try {
      const res = await fetch(`/api/branches/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "刪除失敗");
      if (selectedBranchId === id) setSelectedBranchId(null);
      loadBranches();
      showToast("已刪除分店", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除失敗");
      showToast(err instanceof Error ? err.message : "刪除失敗", "error");
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
    setRoomImageUrl("");
    setRoomImageFile(null);
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
    setRoomImageUrl(r.image_url ?? "");
    setRoomImageFile(null);
    setRoomFormOpen(true);
  };

  const submitRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranchId) return;
    try {
      // Same branch-scoped photo storage the menu uses; the rooms API only accepts its URLs.
      let imageUrl = roomImageUrl || null;
      if (roomImageFile) {
        const form = new FormData();
        form.append("branch_id", selectedBranchId);
        form.append("photo", roomImageFile);
        const upload = await fetch("/api/admin/menu-photos", { method: "POST", body: form });
        const result = await upload.json();
        if (!upload.ok) throw new Error(result.error ?? "照片上傳失敗");
        imageUrl = result.url;
      }
      if (editingRoom) {
        const res = await fetch(`/api/rooms/${editingRoom.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: roomName.trim(), type: roomType.trim() || null, min_capacity: roomMinCapacity, capacity: roomCapacity, price_weekday: roomPriceWeekday, price_weekend: roomPriceWeekend, image_url: imageUrl }),
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
            image_url: imageUrl,
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
    try {
      const res = await fetch(`/api/rooms/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "刪除失敗");
      loadRooms();
      showToast("已刪除包廂", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除失敗");
      showToast(err instanceof Error ? err.message : "刪除失敗", "error");
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

  const addClosedDate = () => {
    if (!closedDateInput || closedDates.includes(closedDateInput)) return;
    setClosedDates((prev) => [...prev, closedDateInput].sort());
    setClosedDateInput("");
  };

  const removeClosedDate = (d: string) =>
    setClosedDates((prev) => prev.filter((x) => x !== d));

  const saveClosedDates = async () => {
    if (!reservationBranchId) {
      setError("請先在訂位區選擇分店");
      return;
    }
    setClosedDatesSaving(true);
    try {
      const res = await fetch(`/api/branches/${encodeURIComponent(reservationBranchId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closed_dates: closedDates }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "儲存失敗");
      await loadBranches();
      setClosedDatesSaved(true);
      setTimeout(() => setClosedDatesSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setClosedDatesSaving(false);
    }
  };

  const saveDepositInfo = async () => {
    setDepositInfoSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deposit_info: depositInfo || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "儲存失敗");
      setDepositInfoSaved(true);
      setTimeout(() => setDepositInfoSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setDepositInfoSaving(false);
    }
  };

  const saveGoogleReviewUrl = async () => {
    setGoogleReviewUrlSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ google_review_url: googleReviewUrl || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "儲存失敗");
      setGoogleReviewUrlSaved(true);
      setTimeout(() => setGoogleReviewUrlSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setGoogleReviewUrlSaving(false);
    }
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw || paymentKeywords.includes(kw)) return;
    setPaymentKeywords((prev) => [...prev, kw]);
    setKeywordInput("");
  };

  const removeKeyword = (kw: string) => setPaymentKeywords((prev) => prev.filter((k) => k !== kw));

  const saveKeywords = async () => {
    setKeywordsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_keywords: paymentKeywords }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "儲存失敗");
      setKeywordsSaved(true);
      setTimeout(() => setKeywordsSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setKeywordsSaving(false);
    }
  };

  if (loading) {
    return (
      <AdminShell title="後台管理" subtitle="載入中…" backHref="/" showLogout={false}>
        <div className="space-y-3" aria-busy="true" aria-label="載入後台">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone-200/80" />
          ))}
        </div>
      </AdminShell>
    );
  }

  return (
    <>
      <AdminShell
        title="後台管理"
        subtitle="昇咖啡 · 營運中樞"
        backHref="/"
      >
        <div className="space-y-6">
          {/* Floor ops — primary */}
          <section aria-label="今日營運">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
              今日營運
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { href: "/admin/today", icon: CalendarDays, label: "今日場控", hint: "尖峰一屏", primary: true },
                { href: "/admin/payments", icon: DollarSign, label: "付款審核", hint: "截圖核准" },
                { href: "/admin/waitlist", icon: Clock, label: "等位清單", hint: "候補通知" },
                { href: "/admin/dashboard", icon: LayoutDashboard, label: "儀表板", hint: "訂位總覽" },
              ].map(({ href, icon: Icon, label, hint, primary }) => (
                <Link
                  key={href}
                  href={href}
                  className={`group flex flex-col gap-2 rounded-2xl border p-3.5 transition-[transform,border-color,background-color,box-shadow] duration-200 active:scale-[0.98] ${
                    primary
                      ? "border-amber-300/80 bg-gradient-to-br from-amber-600 to-amber-700 text-white shadow-[0_10px_24px_-14px_rgba(180,83,9,0.65)] hover:-translate-y-0.5"
                      : "border-stone-200 bg-white text-stone-800 shadow-sm hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md"
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 ${primary ? "text-amber-100" : "text-amber-700"}`}
                    strokeWidth={1.5}
                  />
                  <span className="text-sm font-semibold tracking-wide">{label}</span>
                  <span className={`text-[11px] ${primary ? "text-amber-100/80" : "text-stone-400"}`}>
                    {hint}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          {/* Tools — secondary */}
          <section aria-label="系統工具">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
              系統工具
            </p>
            <ul className="divide-y divide-stone-200/80 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
              {[
                { href: "/admin/orders", icon: ChefHat, label: "即時訂單" },
                { href: "/admin/menu", icon: UtensilsCrossed, label: "菜單管理" },
                { href: "/admin/tables", icon: QrCode, label: "桌位 QR" },
                { href: "/admin/print-station", icon: Printer, label: "列印站" },
                { href: "/admin/reports", icon: BarChart2, label: "營收報表" },
                { href: "/admin/executive", icon: Activity, label: "Executive" }, // 與 /admin/executive 頁面標題「Executive Dashboard」一致；暫不另造中文名
              ].map(({ href, icon: Icon, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-stone-700 transition-[background-color] duration-200 hover:bg-stone-50"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-100 text-amber-700 ring-1 ring-stone-200/80">
                      <Icon className="h-4 w-4" strokeWidth={1.5} />
                    </span>
                    <span className="flex-1">{label}</span>
                    <span className="text-stone-300" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            {error}
          </div>
        )}

        {/* 分店管理 */}
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50/70 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <Building2 className="h-4 w-4 text-amber-700" strokeWidth={1.5} />
              <h2 className="text-sm font-semibold tracking-wide text-stone-700">分店管理</h2>
            </div>
            <button
              type="button"
              onClick={openAddBranch}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-[background-color] duration-200 hover:bg-amber-700"
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
                    <button type="button" onClick={() => setConfirmDeleteBranchId(b.id)} title="刪除"
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
                          <button type="button" onClick={() => setConfirmDeleteRoomId(r.id)} title="刪除"
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
              <ClipboardList className="h-4 w-4 text-amber-700" strokeWidth={1.5} />
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

        {/* 訂金支付方式 */}
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/50 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-blue-400" />
              <h2 className="text-sm font-semibold tracking-wide text-stone-700">訂金支付方式</h2>
            </div>
            <button type="button" onClick={saveDepositInfo} disabled={depositInfoSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors">
              {depositInfoSaving ? "儲存中…" : depositInfoSaved ? "✓ 已儲存" : "儲存"}
            </button>
          </div>
          <div className="p-4">
            <p className="mb-2 text-xs text-stone-400">設定後會顯示在客人填寫訂位表單的最下方，例如：匯款銀行、帳號、戶名等。</p>
            <textarea
              value={depositInfo}
              onChange={(e) => setDepositInfo(e.target.value)}
              rows={4}
              placeholder={"例如：\n訂金請於確認後 3 天內匯款至\n銀行：台灣銀行（004）\n帳號：123-456-789012\n戶名：昇咖啡有限公司"}
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none resize-none"
            />
          </div>
        </section>

        {/* Google 評論邀請 */}
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/50 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold tracking-wide text-stone-700">Google 評論邀請</h2>
            </div>
            <button type="button" onClick={saveGoogleReviewUrl} disabled={googleReviewUrlSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors">
              {googleReviewUrlSaving ? "儲存中…" : googleReviewUrlSaved ? "✓ 已儲存" : "儲存"}
            </button>
          </div>
          <div className="p-4">
            <p className="mb-2 text-xs text-stone-400">
              設定後，當訂位在「訂位管理」標記為「已結帳」，且客人已綁定 LINE，會自動發送一則感謝訊息附上此連結，邀請客人留下 Google 評論。留空則不會發送。
            </p>
            <input
              type="url"
              value={googleReviewUrl}
              onChange={(e) => setGoogleReviewUrl(e.target.value)}
              placeholder="https://g.page/r/xxxxxxxx/review"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
            />
          </div>
        </section>

        {/* 公休日設定 */}
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/50 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <CalendarX className="h-4 w-4 text-red-400" />
              <h2 className="text-sm font-semibold tracking-wide text-stone-700">公休日設定</h2>
            </div>
            <button type="button" onClick={saveClosedDates} disabled={closedDatesSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors">
              {closedDatesSaving ? "儲存中…" : closedDatesSaved ? "✓ 已儲存" : "儲存"}
            </button>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5">
              <p className="text-sm text-amber-900">
                設定分店：
                <span className="ml-1 font-semibold">
                  {reservationBranchId
                    ? branches.find((b) => b.id === reservationBranchId)?.name ?? "—"
                    : "請先選擇分店"}
                </span>
              </p>
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
                disabled={loading || branches.length === 0}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={closedDateInput}
                onChange={(e) => setClosedDateInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addClosedDate()}
                className="rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              />
              <button type="button" onClick={addClosedDate} disabled={!closedDateInput}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 disabled:opacity-40 transition-colors">
                <Plus className="h-3.5 w-3.5" /> 新增
              </button>
            </div>
            {closedDates.length === 0 ? (
              <p className="text-sm text-stone-400">尚無公休日設定。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {closedDates.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-100 px-3 py-1 text-sm text-red-700">
                    {d}
                    <button type="button" onClick={() => removeClosedDate(d)}
                      className="rounded-full p-0.5 hover:bg-red-100 transition-colors" aria-label="移除">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 付款關鍵字設定 */}
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/50 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-green-500" />
              <h2 className="text-sm font-semibold tracking-wide text-stone-700">付款關鍵字設定</h2>
            </div>
            <button type="button" onClick={saveKeywords} disabled={keywordsSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors">
              {keywordsSaving ? "儲存中…" : keywordsSaved ? "✓ 已儲存" : "儲存"}
            </button>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-stone-400">客人傳送的訊息包含以下任一關鍵字（且非問句），系統會自動標記已付訂金。</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                placeholder="輸入關鍵字後按 Enter 或點新增"
                className="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
              />
              <button type="button" onClick={addKeyword} disabled={!keywordInput.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 disabled:opacity-40 transition-colors">
                <Plus className="h-3.5 w-3.5" /> 新增
              </button>
            </div>
            {paymentKeywords.length === 0 ? (
              <p className="text-sm text-stone-400">尚無關鍵字設定。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {paymentKeywords.map((kw) => (
                  <span key={kw} className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-100 px-3 py-1 text-sm text-green-700">
                    {kw}
                    <button type="button" onClick={() => removeKeyword(kw)}
                      className="rounded-full p-0.5 hover:bg-green-100 transition-colors" aria-label="移除">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 訂位管理 */}
        <section id="reservation-management" className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
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
            <ReservationList
              branchId={reservationBranchId}
              rooms={roomsForReservations}
              focusReservationId={focusReservationId}
            />
          </div>
        </section>
        </div>
      </AdminShell>

      <AddReservationForm
        branchId={reservationBranchId}
        rooms={roomsForReservations}
        open={addFormOpen}
        onClose={() => setAddFormOpen(false)}
        onSuccess={(result) => {
          setAddFormOpen(false);
          if (result?.created != null && result.created > 0) {
            showToast(`成功建立 ${result.created} 筆預約！`, "success");
          } else {
            showToast("預約建立成功", "success");
          }
        }}
      />

      <AdminModal
        open={branchFormOpen}
        title={editingBranch ? "編輯分店" : "新增分店"}
        onClose={() => setBranchFormOpen(false)}
        icon={<Building2 className="h-4 w-4 text-amber-600" />}
      >
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
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">LINE 群組 ID</label>
                <input type="text" value={branchLineGroupId} onChange={(e) => setBranchLineGroupId(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder="例：C6aa66403137e743c789ef1388..." />
                <p className="mt-1 text-xs text-stone-400">設定後 Cron 自動推播明日提醒到此群組</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">對客顯示店名</label>
                <input type="text" value={branchDisplayName} onChange={(e) => setBranchDisplayName(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder="例：昇昇咖啡 (大安店)" />
                <p className="mt-1 text-xs text-stone-400">繳費通知開頭顯示用；留空則自動以分店名稱組成</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">匯款資訊</label>
                <textarea value={branchPaymentInfo} onChange={(e) => setBranchPaymentInfo(e.target.value)} rows={4} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder={"【匯款資訊】\n銀行：台北富邦銀行 (012)\n帳號：8212-00000-8489-6\n戶名：..."} />
                <p className="mt-1 text-xs text-stone-400">出現在繳費通知中的匯款帳號區塊；留空則改為「請依官網或現場指示付款」</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">LINE Pay 連結</label>
                <input type="text" value={branchLinePayUrl} onChange={(e) => setBranchLinePayUrl(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder="https://qrcodepay.line.me/..." />
              </div>
              <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-500">以下三項留空＝沿用「設定」頁的全站共用內容；只有這間店不同時才需要填。</p>
              <div>
                <label htmlFor="branch-review-url" className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">此店 Google 評論連結</label>
                <input id="branch-review-url" type="url" value={branchReviewUrl} onChange={(e) => setBranchReviewUrl(e.target.value)} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder="https://g.page/r/..." />
              </div>
              <div>
                <label htmlFor="branch-deposit-info" className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">此店訂金說明（訂位表單顯示）</label>
                <textarea id="branch-deposit-info" value={branchDepositInfo} onChange={(e) => setBranchDepositInfo(e.target.value)} rows={3} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" />
              </div>
              <div>
                <label htmlFor="branch-rental-notes" className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">此店租借注意事項</label>
                <textarea id="branch-rental-notes" aria-describedby="branch-rental-notes-hint" value={branchRentalNotesText} onChange={(e) => setBranchRentalNotesText(e.target.value)} rows={6} className="w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none" placeholder={"入場規則\n請準時入場\n禁止攜帶外食\n\n取消規則\n訂位前 24 小時可免費取消"} />
                <p id="branch-rental-notes-hint" className="mt-1 text-xs text-stone-400">每段第一行是標題，下面每行一個項目；段落之間空一行。客人訂位時需勾選同意。</p>
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
              <div className="rounded-xl border border-stone-200 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
                  <input type="checkbox" checked={branchWeeklyEnabled} onChange={(e) => setBranchWeeklyEnabled(e.target.checked)} className="h-4 w-4" />
                  依星期設定營業時間（不同天不同時間、固定公休）
                </label>
                {branchWeeklyEnabled && (
                  <div className="mt-3 space-y-2" role="group" aria-label="每週營業時間">
                    {branchWeeklyRows.map((row, i) => {
                      const update = (patch: Partial<WeekdayFormRow>) =>
                        setBranchWeeklyRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
                      return (
                        <div key={row.key} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="w-10 font-medium text-stone-700">{WEEKDAY_LABELS[row.key]}</span>
                          <label className="flex items-center gap-1 text-stone-600">
                            <input type="checkbox" checked={row.closed} onChange={(e) => update({ closed: e.target.checked })} aria-label={`${WEEKDAY_LABELS[row.key]}公休`} />
                            公休
                          </label>
                          <input type="time" value={row.open} disabled={row.closed} onChange={(e) => update({ open: e.target.value })} aria-label={`${WEEKDAY_LABELS[row.key]}開始`} className="rounded-lg border border-stone-200 px-2 py-1.5 text-sm focus:border-amber-400 focus:outline-none disabled:bg-stone-100 disabled:text-stone-400" />
                          <span className="text-stone-400">–</span>
                          <input type="time" value={row.close} disabled={row.closed} onChange={(e) => update({ close: e.target.value })} aria-label={`${WEEKDAY_LABELS[row.key]}結束`} className="rounded-lg border border-stone-200 px-2 py-1.5 text-sm focus:border-amber-400 focus:outline-none disabled:bg-stone-100 disabled:text-stone-400" />
                        </div>
                      );
                    })}
                    <p className="text-xs text-stone-400">勾選「公休」的那天，客人不能訂位。</p>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setBranchFormOpen(false)} className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm text-stone-600 hover:bg-stone-50 transition-colors">取消</button>
                <button type="submit" className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors">儲存</button>
              </div>
            </form>
      </AdminModal>

      <AdminModal
        open={roomFormOpen}
        title={editingRoom ? "編輯包廂" : "新增包廂"}
        onClose={() => setRoomFormOpen(false)}
        icon={<LayoutGrid className="h-4 w-4 text-amber-500" />}
      >
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
              <div>
                <label htmlFor="room-photo" className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-wide">包廂照片</label>
                {roomImageUrl && !roomImageFile && (
                  <div className="mb-2 flex items-center gap-3">
                    <div className="relative h-16 w-28 overflow-hidden rounded-lg bg-stone-100">
                      <Image src={roomImageUrl} alt="目前的包廂照片" fill sizes="112px" className="object-cover" />
                    </div>
                    <button type="button" onClick={() => setRoomImageUrl("")} className="text-xs text-rose-700 underline">移除照片</button>
                  </div>
                )}
                <input id="room-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setRoomImageFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm" />
                <p className="mt-1 text-xs text-stone-400">JPG、PNG 或 WebP，5 MB 以下。按「儲存」時才會上傳；客人在訂位頁選包廂時會看到。</p>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setRoomFormOpen(false)} className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm text-stone-600 hover:bg-stone-50 transition-colors">取消</button>
                <button type="submit" className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors">儲存</button>
              </div>
            </form>
      </AdminModal>
      <ConfirmDialog
        open={confirmDeleteBranchId !== null}
        title="刪除分店"
        message="確定要刪除此分店嗎？底下的包廂與預約也會一併刪除。"
        confirmLabel="刪除"
        variant="danger"
        onConfirm={() => {
          const id = confirmDeleteBranchId;
          setConfirmDeleteBranchId(null);
          if (id) void deleteBranch(id);
        }}
        onCancel={() => setConfirmDeleteBranchId(null)}
      />
      <ConfirmDialog
        open={confirmDeleteRoomId !== null}
        title="刪除包廂"
        message="確定要刪除此包廂嗎？"
        confirmLabel="刪除"
        variant="danger"
        onConfirm={() => {
          const id = confirmDeleteRoomId;
          setConfirmDeleteRoomId(null);
          if (id) void deleteRoom(id);
        }}
        onCancel={() => setConfirmDeleteRoomId(null)}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
