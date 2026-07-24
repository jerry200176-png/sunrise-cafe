/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminShell } from "./AdminShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/today",
}));

vi.mock("next/image", () => ({
  default: (props: { alt: string }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt} />;
  },
}));

describe("AdminShell", () => {
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
});
