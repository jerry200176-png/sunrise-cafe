// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BatchDepositMessageWorkbench } from "./BatchDepositMessageWorkbench";
import type { BatchReservationMessageItem } from "@/lib/reservation-message-batch";

vi.mock("@/lib/message-copy-digest", () => ({ messageCopyDigest: async () => "a".repeat(64) }));

const item = { reservation_id: "synthetic", customer_name: "測試", booking_code: "A01", date_label: "測試日期", text: "合成訊息", deposit_amount: 10 } as BatchReservationMessageItem;
function props() { return { reservationIds: ["synthetic"], batchId: "batch", items: [item], combinedText: item.text, canBatchCopy: true, warnings: [], onClose: vi.fn(), beginCopy: () => true, endCopy: vi.fn(), copyBusy: false, isCurrent: () => true }; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, "throw"])("cleans up fallback and does not record when copy returns %s", async (result) => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => { if (result === "throw") throw Error("copy"); return false; }) });
  const post = vi.fn(); vi.stubGlobal("fetch", post);
  const p = props(); render(<BatchDepositMessageWorkbench {...p} />);
  const button = screen.getByRole("button", { name: "單獨複製" }); button.focus(); fireEvent.click(button);
  await screen.findByText(/複製失敗/);
  expect(post).not.toHaveBeenCalled(); expect(p.endCopy).toHaveBeenCalledOnce();
  expect(document.querySelectorAll("textarea")).toHaveLength(1);
  expect(document.activeElement).toBe(button);
  expect((screen.getByRole("textbox", { name: /訊息內容，可手動選取/ }) as HTMLTextAreaElement).value).toBe("合成訊息");
});

it("does not record a late copy after workbench invalidation", async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => { resolve = done; });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => pending } });
  const post = vi.fn(); vi.stubGlobal("fetch", post);
  let current = true; const p = props();
  render(<BatchDepositMessageWorkbench {...p} isCurrent={() => current} />);
  fireEvent.click(screen.getByRole("button", { name: "複製全部" }));
  current = false;
  await act(async () => { resolve(); await pending; });
  expect(post).not.toHaveBeenCalled(); expect(p.endCopy).toHaveBeenCalledOnce();
});

it("removes the temporary field if selecting text throws", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  vi.spyOn(HTMLTextAreaElement.prototype, "select").mockImplementation(() => { throw Error("selection"); });
  const post = vi.fn(); vi.stubGlobal("fetch", post);
  render(<BatchDepositMessageWorkbench {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "複製全部" }));
  await screen.findByText(/複製失敗/);
  expect(document.querySelectorAll("textarea")).toHaveLength(1);
  expect(post).not.toHaveBeenCalled();
});

it("treats a lost audit response as unknown and blocks another request", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  const post = vi.fn().mockRejectedValue(Error("network")); vi.stubGlobal("fetch", post);
  render(<BatchDepositMessageWorkbench {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "複製全部" }));
  await screen.findByText(/紀錄結果未確認/);
  expect((screen.getByRole("button", { name: "複製全部" }) as HTMLButtonElement).disabled).toBe(true);
  expect(post).toHaveBeenCalledOnce();
});

it("records exactly one successful copy and confirms its result", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  const post = vi.fn().mockResolvedValue(Response.json({ ok: true, version: 2, batch_id: "batch", action_ids: ["synthetic-action"] }));
  vi.stubGlobal("fetch", post);
  render(<BatchDepositMessageWorkbench {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "單獨複製" }));
  await screen.findByText(/已複製不等於已傳送/);
  expect(post).toHaveBeenCalledOnce();
  expect(JSON.parse(String(post.mock.calls[0][1].body)).action).toBe("copied");
});

it("falls back safely when the clipboard getter throws", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, get() { throw Error("blocked"); } });
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
  const post = vi.fn(); vi.stubGlobal("fetch", post);
  const p = props(); render(<BatchDepositMessageWorkbench {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "複製全部" }));
  await screen.findByText(/複製失敗/);
  expect(post).not.toHaveBeenCalled(); expect(p.endCopy).toHaveBeenCalledOnce();
});

it("does not report a malformed successful audit response as recorded", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ version: 2, batch_id: "batch", action_ids: ["id"] })));
  render(<BatchDepositMessageWorkbench {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "單獨複製" }));
  await screen.findByText(/紀錄結果未確認/);
  expect((screen.getByRole("button", { name: "單獨複製" }) as HTMLButtonElement).disabled).toBe(true);
});
