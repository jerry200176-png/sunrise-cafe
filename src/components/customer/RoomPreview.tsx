"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { FallbackBoundary } from "@/components/admin/FallbackBoundary";
import { DAAN_FLOOR_PLAN, normalizeRoomName } from "@/lib/floor-plan";
import { useLocale } from "@/lib/i18n/LocaleContext";

function SceneLoading() {
  const { t } = useLocale();
  return <p role="status" className="p-4 text-sm text-gray-600">{t("book.room.previewLoading")}</p>;
}

const Scene = dynamic(() => import("./RoomPreviewScene"), { ssr: false, loading: SceneLoading });

/** Never use the admin floor's automatic name/capacity fallback for guest-facing room identity. */
export function previewRoomForBranch(branch: string, room: string) {
  const knownBranches = ["大安店", "昇咖啡 大安店"];
  const plan = knownBranches.includes(branch.trim()) ? DAAN_FLOOR_PLAN : null;
  const name = normalizeRoomName(room);
  const matches = plan?.rooms.filter((slot) => slot.names.some((n) => normalizeRoomName(n) === name)) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

export function RoomPreview({ branch, room, open, onToggle }: { branch: string; room: string; open: boolean; onToggle: () => void }) {
  const { t } = useLocale();
  const [attempt, setAttempt] = useState(0);
  const slot = previewRoomForBranch(branch, room);
  if (!slot) return null;
  const model = `/models/rooms/${slot.slot}.glb`;
  const retryModel = async () => {
    try {
      const { useGLTF } = await import("@react-three/drei");
      useGLTF.clear(model);
      setAttempt((value) => value + 1);
    } catch {
      // Keep the original message and retry button when the viewer chunk itself is unavailable.
    }
  };
  return (
    <div className="mt-2 rounded-xl border border-amber-100 bg-white p-3">
      <button type="button" aria-expanded={open} onClick={onToggle}
        className="min-h-11 w-full rounded-lg px-2 text-left text-sm font-medium text-amber-800 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700">
        {open ? t("book.room.previewClose") : t("book.room.previewOpen")} · {room}
      </button>
      {open && (
        <div className="space-y-2">
          <p className="text-xs leading-relaxed text-gray-600">{t("book.room.previewNotice")}</p>
          <p className="text-xs text-gray-600">{t("book.room.previewDimensions", { width: (slot.rect.w / 100).toFixed(2), depth: (slot.rect.d / 100).toFixed(2) })}</p>
          <FallbackBoundary key={`${slot.slot}:${attempt}`} fallback={<div className="p-4 text-sm text-gray-600"><p role="status">{t("book.room.previewError")}</p><button type="button" className="mt-2 min-h-11 rounded-lg border border-amber-300 px-3 text-amber-900" onClick={retryModel}>{t("common.retry")}</button></div>}>
            <Scene width={slot.rect.w / 100} depth={slot.rect.d / 100} model={model} fallback={t("book.room.previewError")} loading={t("book.room.previewLoading")} rotateLeft={t("book.room.previewLeft")} rotateRight={t("book.room.previewRight")} />
          </FallbackBoundary>
          <p className="text-xs text-gray-500">{t("book.room.previewControls")}</p>
        </div>
      )}
    </div>
  );
}
