/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminShell } from "./AdminShell";

const pathnameRef = { current: "/admin/today" };

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}));

vi.mock("next/image", () => ({
  default: (props: { alt: string }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt} />;
  },
}));

describe("AdminShell", () => {
  beforeEach(() => {
    pathnameRef.current = "/admin/today";
    vi.restoreAllMocks();
  });

  it("renders title as sole h1 and marks active nav", () => {
    render(
      <AdminShell title="今日場控" subtitle="尖峰一屏完成">
        <p>內容</p>
      </AdminShell>
    );
    expect(screen.getByRole("heading", { level: 1, name: "今日場控" })).toBeTruthy();
    expect(screen.getByText("尖峰一屏完成")).toBeTruthy();
    const today = screen.getByRole("link", { name: "今日" });
    expect(today.getAttribute("aria-current")).toBe("page");
    // First bottom-nav item is CalendarDays (lucide) + 今日 — not a brand/logo glyph.
    expect(today.querySelector("svg")).toBeTruthy();
    expect(today.textContent).toContain("今日");
  });

  it("keeps exactly one active bottom-nav item per route", () => {
    const cases: Array<{ path: string; active: string }> = [
      { path: "/admin/today", active: "今日" },
      { path: "/admin/payments", active: "付款" },
      { path: "/admin", active: "首頁" },
      { path: "/admin/waitlist", active: "等位" },
      { path: "/admin/dashboard", active: "儀表" },
    ];
    for (const { path, active } of cases) {
      pathnameRef.current = path;
      const { unmount } = render(
        <AdminShell title="t">
          <p>x</p>
        </AdminShell>
      );
      const nav = screen.getByRole("navigation", { name: "後台導覽" });
      const currents = nav.querySelectorAll('[aria-current="page"]');
      expect(currents.length).toBe(1);
      expect(currents[0].textContent).toContain(active);
      unmount();
    }
  });

  it("does not mark hub children as 首頁-active when exact", () => {
    pathnameRef.current = "/admin/menu";
    render(
      <AdminShell title="t">
        <p>x</p>
      </AdminShell>
    );
    const home = screen.getByRole("link", { name: "首頁" });
    expect(home.getAttribute("aria-current")).toBeNull();
  });

  it("can hide bottom nav and back link", () => {
    render(
      <AdminShell title="後台管理" backHref={null} showNav={false} showLogout={false}>
        <p>hub</p>
      </AdminShell>
    );
    expect(screen.queryByRole("navigation", { name: "後台導覽" })).toBeNull();
    expect(screen.queryByLabelText("返回")).toBeNull();
    expect(screen.queryByLabelText("登出")).toBeNull();
  });

  it("keeps the bottom nav in normal document flow on desktop", () => {
    render(
      <AdminShell title="後台管理">
        <p>內容</p>
      </AdminShell>
    );
    const main = screen.getByRole("main");
    const nav = screen.getByRole("navigation", { name: "後台導覽" });
    expect(main.className).toContain("md:pb-10");
    expect(nav.className).toContain("md:static");
    expect(nav.className).toContain("md:border-t-0");
  });

  it("logout uses POST /api/admin/logout", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    // jsdom location is hard to replace; spy via redefine
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, href: "http://localhost/admin", assign },
    });

    render(
      <AdminShell title="t">
        <p>x</p>
      </AdminShell>
    );
    await userEvent.click(screen.getByLabelText("登出"));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/logout", { method: "POST" });

    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});
