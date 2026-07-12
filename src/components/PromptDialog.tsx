"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

type PromptDialogProps = {
  open: boolean;
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

export function PromptDialog({
  open,
  title,
  message,
  placeholder,
  defaultValue = "",
  confirmLabel = "確認",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => {
        const input = inputRef.current;
        if (!input) return;
        input.value = defaultValue;
        input.focus();
        input.select();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [open, defaultValue]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-dialog-title"
      onClick={onCancel}
    >
      <div
        className="flex w-full max-w-sm flex-col rounded-t-2xl sm:rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 id="prompt-dialog-title" className="text-lg font-semibold text-gray-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="-mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-4 py-4">
          <p className="mb-3 text-sm text-gray-700">{message}</p>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            defaultValue={defaultValue}
            placeholder={placeholder}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onConfirm(inputRef.current?.value ?? "");
              }
            }}
          />
        </div>
        <div className="flex gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(inputRef.current?.value ?? "")}
            className="flex-1 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
