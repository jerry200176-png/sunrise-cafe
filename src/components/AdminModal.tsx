"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type AdminModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  icon?: ReactNode;
};

export function AdminModal({ open, title, onClose, children, icon }: AdminModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => panelRef.current?.focus());
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4 backdrop-blur-sm overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-modal-title"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-stone-100 px-5 py-4">
          <div className="flex items-center gap-2">
            {icon}
            <h3 id="admin-modal-title" className="text-base font-semibold text-stone-800">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
