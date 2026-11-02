// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import { GuestCopyButton } from "@/components/GuestCopyButton";
import { CopyBookingCodeButton } from "@/components/CopyBookingCodeButton";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExec = Object.getOwnPropertyDescriptor(document, "execCommand");
function clipboard(value: unknown) { Object.defineProperty(navigator, "clipboard", { configurable: true, value }); }
function execCommand(value: unknown) { Object.defineProperty(document, "execCommand", { configurable: true, value }); }
function show(children: React.ReactNode) { return render(<LocaleProvider>{children}</LocaleProvider>); }

afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  if (originalExec) Object.defineProperty(document, "execCommand", originalExec);
  else Reflect.deleteProperty(document, "execCommand");
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("guest copy feedback", () => {
  it("awaits the clipboard and blocks duplicate clicks until success", async () => {
    let complete!: () => void;
    const writeText = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    clipboard({ writeText });
    show(<GuestCopyButton identity="account" getText={() => "synthetic account"} label="複製資料" copiedLabel="複製成功" />);
    fireEvent.click(screen.getByRole("button", { name: "複製資料" }));
    fireEvent.click(screen.getByRole("button", { name: "複製中…" }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("synthetic account");
    expect((screen.getByRole("button", { name: "複製中…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("複製成功")).toBeNull();
    await act(async () => complete());
    expect(screen.getByRole("status").textContent).toBe("複製成功");
    expect((screen.getByRole("button", { name: "複製成功" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(["rejected", "fallback false", "fallback throws", "fallback missing"])("%s exposes manual text without claiming success", async (mode) => {
    if (mode === "rejected") clipboard({ writeText: vi.fn().mockRejectedValue(new Error("permission denied")) });
    else {
      clipboard(undefined);
      if (mode === "fallback false") execCommand(vi.fn(() => false));
      if (mode === "fallback throws") execCommand(vi.fn(() => { throw new Error("unsupported"); }));
      if (mode === "fallback missing") execCommand(undefined);
    }
    show(<GuestCopyButton identity="payment" getText={() => "synthetic payment info"} label="複製資料" copiedLabel="複製成功" />);
    fireEvent.click(screen.getByRole("button", { name: "複製資料" }));
    const field = await screen.findByRole("textbox", { name: "可手動複製的文字" }) as HTMLTextAreaElement;
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe("synthetic payment info");
    fireEvent.focus(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(screen.getByRole("status").textContent).toContain("無法自動複製");
    expect(screen.queryByText("複製成功")).toBeNull();
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("accepts an explicit true from the legacy fallback and removes its temporary input", async () => {
    clipboard(undefined);
    const legacy = vi.fn(() => true);
    execCommand(legacy);
    show(<GuestCopyButton identity="code" getText={() => "ABC123"} label="複製資料" copiedLabel="複製成功" />);
    fireEvent.click(screen.getByRole("button", { name: "複製資料" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("複製成功"));
    expect(legacy).toHaveBeenCalledWith("copy");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("keeps each guest action independent and lets failures be retried", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
    clipboard({ writeText });
    show(<><GuestCopyButton identity="A" getText={() => "A"} label="複製 A" copiedLabel="A 已複製" /><GuestCopyButton identity="B" getText={() => "B"} label="複製 B" copiedLabel="B 已複製" /></>);
    fireEvent.click(screen.getByRole("button", { name: "複製 A" }));
    await screen.findByRole("textbox", { name: "可手動複製的文字" });
    fireEvent.click(screen.getByRole("button", { name: "複製 B" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "B 已複製" })).toBeTruthy());
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("A");
    fireEvent.click(screen.getByRole("button", { name: "複製 A" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "A 已複製" })).toBeTruthy());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(writeText.mock.calls.map(([text]) => text)).toEqual(["A", "B", "A"]);
  });

  it.each([
    ["zh-TW", "複製訂位代號", "可手動複製的文字"],
    ["en", "Copy booking code", "Text to copy manually"],
    ["ja", "予約番号をコピー", "手動でコピーするテキスト"],
  ])("provides a labelled manual booking code in %s", async (locale, button, label) => {
    localStorage.setItem("sunrise_locale", locale);
    clipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    show(<CopyBookingCodeButton code="ABC123" />);
    fireEvent.click(await screen.findByRole("button", { name: button }));
    expect((await screen.findByRole("textbox", { name: label }) as HTMLTextAreaElement).value).toBe("ABC123");
  });

  it.each(["resolve", "reject"])("ignores a late %s after the booking code changes", async (outcome) => {
    let finish!: () => void;
    let reject!: (reason: Error) => void;
    clipboard({ writeText: () => new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; }) });
    const view = show(<CopyBookingCodeButton code="OLD123" />);
    fireEvent.click(screen.getByRole("button", { name: "複製訂位代號" }));
    view.rerender(<LocaleProvider><CopyBookingCodeButton code="NEW456" /></LocaleProvider>);
    const button = screen.getByRole("button", { name: "複製訂位代號" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(async () => outcome === "resolve" ? finish() : reject(new Error("denied")));
    expect(screen.queryByText("已複製")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("clears a failed manual fallback when the copied content changes", async () => {
    clipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const view = show(<CopyBookingCodeButton code="OLD123" />);
    fireEvent.click(screen.getByRole("button", { name: "複製訂位代號" }));
    expect((await screen.findByRole("textbox") as HTMLTextAreaElement).value).toBe("OLD123");
    view.rerender(<LocaleProvider><CopyBookingCodeButton code="NEW456" /></LocaleProvider>);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("ignores a late result after unmount", async () => {
    let complete!: () => void;
    clipboard({ writeText: () => new Promise<void>((resolve) => { complete = resolve; }) });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = show(<CopyBookingCodeButton code="ABC123" />);
    fireEvent.click(screen.getByRole("button", { name: "複製訂位代號" }));
    view.unmount();
    await act(async () => complete());
    expect(error).not.toHaveBeenCalled();
  });
});
