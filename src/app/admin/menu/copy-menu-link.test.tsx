// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminMenuPage from "./page";

vi.mock("@/lib/use-admin-branches", () => ({ useAdminBranches: () => ({ branches: [], loading: false, error: null, retry: vi.fn() }) }));
vi.mock("@/components/admin/OptionSetsPanel", () => ({ OptionSetsPanel: () => null }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("next/image", () => ({ default: () => null }));

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});
function clipboard(value: { writeText: (value: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

describe("菜單網址的複製回饋", () => {
  it("等待剪貼簿確認期間阻止重複執行，完成後才顯示成功", async () => {
    let resolveCopy!: () => void;
    const writeText = vi.fn(() => new Promise<void>((resolve) => { resolveCopy = resolve; }));
    clipboard({ writeText });
    render(<AdminMenuPage />);
    const copy = screen.getByRole("button", { name: "複製網址" });
    fireEvent.click(copy);
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/menu`);
    expect((screen.getByRole("button", { name: "複製中…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("正在複製菜單網址…").getAttribute("role")).toBe("status");
    expect(screen.queryByText("已複製菜單網址")).toBeNull();
    await act(async () => resolveCopy());
    expect(screen.getByText("已複製菜單網址")).toBeTruthy();
    expect((screen.getByRole("button", { name: "複製網址" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(["reject", "missing", "throw"])("%s 時顯示失敗並保留手動複製及重試", async (mode) => {
    const writeText = vi.fn(() => {
      if (mode === "throw") throw new Error("denied");
      return Promise.reject(new Error("denied"));
    });
    clipboard(mode === "missing" ? undefined : { writeText });
    render(<AdminMenuPage />);
    fireEvent.click(screen.getByRole("button", { name: "複製網址" }));
    expect(await screen.findByText("無法自動複製，請選取菜單網址欄位後手動複製")).toBeTruthy();
    expect(screen.queryByText("已複製菜單網址")).toBeNull();
    const manual = screen.getByRole("textbox", { name: "菜單網址（可手動複製）" }) as HTMLInputElement;
    expect(manual.readOnly).toBe(true);
    expect(manual.value).toBe(`${window.location.origin}/menu`);
    expect((screen.getByRole("button", { name: "複製網址" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("link", { name: "開啟菜單（新分頁）" }).getAttribute("href")).toBe("/menu");
  });

  it("手動網址欄與菜單連結可用鍵盤到達", async () => {
    const user = userEvent.setup();
    render(<AdminMenuPage />);
    const manual = screen.getByRole("textbox", { name: "菜單網址（可手動複製）" });
    const link = screen.getByRole("link", { name: "開啟菜單（新分頁）" });
    let reachedInput = false;
    let reachedLink = false;
    for (let i = 0; i < 20 && !reachedLink; i++) {
      await user.tab();
      reachedInput ||= document.activeElement === manual;
      reachedLink ||= document.activeElement === link;
    }
    expect(reachedInput).toBe(true);
    expect(reachedLink).toBe(true);
  });
});
