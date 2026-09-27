"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLocale } from "@/lib/i18n/LocaleContext";

type CustomerShellProps = {
  title: string;
  backHref?: string;
  children: React.ReactNode;
};

/** Shared customer-facing page shell — aligns book/query/success with landing design tokens. */
export function CustomerShell({ title, backHref = "/", children }: CustomerShellProps) {
  const { t } = useLocale();

  return (
    <main className="grain min-h-screen">
      <header className="sticky top-0 z-20 border-b border-ink/10 bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            <Link
              href={backHref}
              className="flex items-center justify-center rounded-xl p-2 text-ink-soft transition hover:bg-paper-deep"
              aria-label={t("common.back")}
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <div className="relative h-7 w-7 shrink-0" aria-hidden="true">
                <Image src="/logo.webp" alt="" fill className="object-contain" />
              </div>
              <h1 className="font-serif text-base font-medium leading-tight tracking-wide text-ink">
                {title}
              </h1>
            </div>
          </div>
          <LanguageSwitcher className="shrink-0 [&>button]:whitespace-nowrap" />
        </div>
      </header>
      <div className="mx-auto max-w-lg px-4 py-6">{children}</div>
    </main>
  );
}
