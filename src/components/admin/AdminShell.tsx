"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  DollarSign,
  CalendarCheck,
  LayoutDashboard,
  LogOut,
  Box,
} from "lucide-react";

export type AdminShellProps = {
  title: string;
  subtitle?: string;
  /** Back target. Use `null` to hide. Default `/admin`. Home hub should pass `"/"`. */
  backHref?: string | null;
  actions?: React.ReactNode;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: "lg" | "3xl" | "4xl" | "5xl";
  /** Floor-ops bottom nav. Default true. */
  showNav?: boolean;
  showLogout?: boolean;
};

const NAV = [
  { href: "/admin/today", label: "今日", icon: CalendarDays },
  { href: "/admin/floor", label: "包廂", icon: Box },
  { href: "/admin", label: "訂位", icon: CalendarCheck, exact: true },
  { href: "/admin/payments", label: "付款", icon: DollarSign },
  { href: "/admin/waitlist", label: "等位", icon: ClipboardList },
  { href: "/admin/dashboard", label: "儀表板", icon: LayoutDashboard },
] as const;

const MAX_W = {
  lg: "max-w-lg",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
} as const;

async function logout() {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.href = "/admin/login";
}

/** Shared admin chrome — sticky header + optional floor-ops bottom nav (stone/amber). */
export function AdminShell({
  title,
  subtitle,
  backHref = "/admin",
  actions,
  headerExtra,
  children,
  maxWidth = "4xl",
  showNav = true,
  showLogout = true,
}: AdminShellProps) {
  const pathname = usePathname();
  const width = MAX_W[maxWidth];

  return (
    <div className="min-h-[100dvh] bg-stone-100 text-stone-900">
      <header className="sticky top-0 z-30 border-b border-stone-200/90 bg-white/95 backdrop-blur-md">
        <div className={`mx-auto flex ${width} items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4`}>
          {backHref != null && (
            <Link
              href={backHref}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone-500 transition-[background-color,color] duration-200 hover:bg-stone-100 hover:text-stone-800"
              aria-label="返回"
            >
              <ArrowLeft className="h-5 w-5" strokeWidth={1.5} />
            </Link>
          )}

          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="relative hidden h-8 w-8 shrink-0 sm:block" aria-hidden>
              <Image src="/logo.webp" alt="" fill className="object-contain" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-stone-800 sm:text-[1.05rem]">
                {title}
              </h1>
              {subtitle ? (
                <p className="truncate text-[11px] tracking-wide text-stone-500">{subtitle}</p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            {showLogout ? (
              <button
                type="button"
                onClick={() => void logout()}
                className="flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-stone-200 px-2.5 text-sm font-medium text-stone-600 transition-[background-color,border-color] duration-200 hover:border-stone-300 hover:bg-stone-50"
                aria-label="登出"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.5} />
                <span className="hidden sm:inline">登出</span>
              </button>
            ) : null}
          </div>
        </div>
        {headerExtra ? (
          <div className={`mx-auto ${width} px-3 pb-3 sm:px-4`}>{headerExtra}</div>
        ) : null}
      </header>

      <main className={`mx-auto ${width} px-3 py-4 sm:px-4 sm:py-6 ${showNav ? "pb-24 md:pb-10" : "pb-10"}`}>
        {children}
      </main>

      {showNav ? (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/90 bg-white/95 backdrop-blur-md sticky-bottom-safe md:static md:z-auto md:border-t-0 md:bg-transparent md:backdrop-blur-none"
          aria-label="後台導覽"
        >
          <ul className={`mx-auto grid ${width} grid-cols-6 gap-0.5 px-1 pt-1.5`}>
            {NAV.map(({ href, label, icon: Icon, ...rest }) => {
              const exact = "exact" in rest && rest.exact;
              const active = exact
                ? pathname === href
                : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-medium tracking-wide transition-[background-color,color] duration-200 ${
                      active
                        ? "bg-amber-50 text-amber-800"
                        : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
                    }`}
                  >
                    <Icon
                      className={`h-[1.15rem] w-[1.15rem] ${active ? "text-amber-700" : ""}`}
                      strokeWidth={active ? 2 : 1.5}
                    />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
