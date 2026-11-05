"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";

type Props = {
  /** Changes whenever the content being copied changes. Never written to logs or storage. */
  identity: string;
  getText: () => string;
  label: string;
  copiedLabel: string;
  ariaLabel?: string;
  className?: string;
};

/** A content change abandons pending state and any old manual fallback. */
export function GuestCopyButton(props: Props) {
  return <GuestCopyButtonInstance key={props.identity} {...props} />;
}

/** Keep the failed text local to this button so a guest can select it manually. */
function GuestCopyButtonInstance({ getText, label, copiedLabel, ariaLabel, className = "" }: Props) {
  const { t } = useLocale();
  const [state, setState] = useState<"idle" | "pending" | "copied" | "error">("idle");
  const [manualText, setManualText] = useState("");
  const busy = useRef(false);
  const mounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    if (busy.current) return;
    busy.current = true;
    if (timer.current) clearTimeout(timer.current);
    setState("pending");
    let text = "";
    try {
      text = getText();
      if (!text) throw new Error("empty copy");
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const input = document.createElement("textarea");
        input.value = text;
        input.readOnly = true;
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        let copied = false;
        try {
          input.focus();
          input.select();
          copied = document.execCommand("copy");
        } finally {
          // Do not pull focus back if another action has already moved it.
          const restoreFocus = document.activeElement === input;
          input.remove();
          if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
        }
        if (!copied) throw new Error("copy unavailable");
      }
      if (!mounted.current) return;
      setManualText("");
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 2000);
    } catch {
      if (!mounted.current) return;
      setManualText(text);
      setState("error");
    } finally {
      busy.current = false;
    }
  }

  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <button type="button" onClick={copy} disabled={state === "pending"} aria-label={ariaLabel} className={className}>
        {state === "copied" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        {state === "pending" ? t("copy.pending") : state === "copied" ? copiedLabel : label}
      </button>
      <span role="status" aria-live="polite" className={state === "error" ? "text-xs text-red-700" : "sr-only"}>
        {state === "error" ? t("copy.error") : state === "copied" ? copiedLabel : state === "pending" ? t("copy.pending") : ""}
      </span>
      {state === "error" && manualText && (
        <textarea
          aria-label={t("copy.manualLabel")}
          readOnly
          value={manualText}
          rows={3}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-16 w-full min-w-48 max-w-full rounded border border-gray-400 bg-white p-2 text-xs text-gray-900"
        />
      )}
    </span>
  );
}
