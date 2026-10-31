"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { FallbackBoundary } from "@/components/admin/FallbackBoundary";
import { previewRoomForBranch } from "./RoomPreview";
import { useLocale } from "@/lib/i18n/LocaleContext";

export type StorePreviewRoom = { roomId: string; roomName: string; available: boolean; partyStatus?: "invalid" | "mismatch" | null };
export type MappedStoreRoom = StorePreviewRoom & { slot: string };

/** Only expose rooms with an unambiguous name/branch match; never guess. */
export function mapStoreRooms(branch: string, rooms: StorePreviewRoom[]): MappedStoreRoom[] {
  const candidates = rooms.flatMap((room) => {
    const match = previewRoomForBranch(branch, room.roomName);
    return match ? [{ ...room, slot: match.slot }] : [];
  });
  return candidates.filter((room) => candidates.filter((other) => other.slot === room.slot).length === 1);
}

function SceneLoading() {
  const { t } = useLocale();
  return <p role="status" className="p-4 text-sm text-gray-600">{t("book.room.previewLoading")}</p>;
}
const Scene = dynamic(() => import("./StorePreviewScene"), { ssr: false, loading: SceneLoading });
const MODEL = "/models/store/daan.glb";

export function StorePreview({ branch, rooms, selectedId, onSelect }: {
  branch: string; rooms: StorePreviewRoom[]; selectedId: string | null; onSelect: (roomId: string) => void;
}) {
  const { t } = useLocale();
  const mapped = useMemo(() => mapStoreRooms(branch, rooms), [branch, rooms]);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (!mapped.length) return null;
  const retry = async () => {
    try {
      const { useGLTF } = await import("@react-three/drei");
      useGLTF.clear(MODEL);
      setAttempt((n) => n + 1);
    } catch { /* Keep the fallback and retry button. */ }
  };
  const unavailable = <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
    <p role="status">{t("book.store.error")}</p>
    <button type="button" onClick={retry} className="mt-2 min-h-11 rounded-lg border border-amber-300 px-3">{t("common.retry")}</button>
  </div>;
  return <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4" aria-label={t("book.store.title")}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold text-gray-900">{t("book.store.title")}</h3><p className="mt-1 text-sm text-gray-600">{t("book.store.intro")}</p></div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="min-h-11 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800">
        {open ? t("book.store.close") : t("book.store.open")}
      </button>
    </div>
    {open && <div className="mt-3 space-y-3">
      <p className="text-xs leading-relaxed text-gray-600">{t("book.room.previewNotice")}</p>
      <FallbackBoundary key={attempt} fallback={unavailable}>
        <Scene model={MODEL} rooms={mapped} selectedId={selectedId} onSelect={onSelect} loading={t("book.room.previewLoading")} labelsLabel={t("book.store.canvasRooms")} fallback={unavailable} />
      </FallbackBoundary>
      <p className="text-xs text-gray-600">{t("book.store.controls")}</p>
      <div className="flex flex-wrap gap-2" aria-label={t("book.store.selectRoom")}>
        {mapped.map((room) => <button key={room.roomId} type="button" aria-pressed={selectedId === room.roomId} onClick={() => onSelect(room.roomId)}
          className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 text-sm text-amber-950 aria-pressed:bg-amber-200">
          {room.roomName} · {!room.available ? t("book.room.full") : room.partyStatus === "invalid" ? t("book.store.partyInvalid") : room.partyStatus === "mismatch" ? t("book.store.partyMismatch") : t("book.room.available")}
        </button>)}
      </div>
    </div>}
  </section>;
}
