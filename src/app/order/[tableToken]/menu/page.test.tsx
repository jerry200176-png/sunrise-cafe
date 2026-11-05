// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MenuPage from "./page";
vi.mock("next/navigation", () => ({ useParams: () => ({ tableToken: "synthetic" }), useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
it("explains an archived branch instead of showing an empty menu or stale cart", async () => {
  localStorage.setItem("cart-synthetic", JSON.stringify([{ quantity: 1, menuItem: { price: 100 }, selectedOptions: [] }]));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "此分店目前無法點餐" }, { status: 403 })));
  render(<MenuPage />);
  expect((await screen.findByRole("alert")).textContent).toContain("此分店目前無法點餐");
  expect(screen.queryByText("此分類尚無餐點")).toBeNull();
  expect(screen.queryByText("查看購物車")).toBeNull();
});
it.each(["qr-order.pending:synthetic", "qr-order.pending:synthetic:review:operation-1"])("prevents menu edits and preserves the submitted cart with hold %s", async (holdKey) => {
  const original = JSON.stringify([{ quantity: 1, menuItem: { id: "old", name: "原餐點", price: 100 }, selectedOptions: [], specialNotes: "" }]);
  localStorage.setItem("cart-synthetic", original);
  localStorage.setItem(holdKey, "pending");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/tables/")
    ? Response.json({ branch_id: "b", branches: { name: "branch" } })
    : Response.json({ categories: [], items: [{ id: "new", name: "其他餐點", price: 120, is_available: true, options: [] }] })));
  render(<MenuPage />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/請先向店員核對/);
  const add = await screen.findByRole("button", { name: "選擇其他餐點" }) as HTMLButtonElement;
  expect(add.disabled).toBe(true);
  add.click();
  expect(localStorage.getItem("cart-synthetic")).toBe(original);
});
it("does not resurrect a completed cart when another tab clears the cart and hold", async () => {
  const cartKey = "cart-synthetic";
  const holdKey = "qr-order.pending:synthetic";
  const original = JSON.stringify([{ quantity: 1, menuItem: { id: "old", name: "原餐點", price: 100 }, selectedOptions: [], specialNotes: "" }]);
  localStorage.setItem(cartKey, original);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/tables/")
    ? Response.json({ branch_id: "b", branches: { name: "branch" } })
    : Response.json({ categories: [], items: [{ id: "new", name: "新餐點", price: 120, is_available: true, options: [] }] })));
  render(<MenuPage />);
  await screen.findByRole("button", { name: "選擇新餐點" });
  expect(screen.getByText("查看購物車")).toBeTruthy();
  act(() => { localStorage.setItem(holdKey, "pending"); window.dispatchEvent(new StorageEvent("storage", { key: holdKey })); });
  act(() => {
    localStorage.removeItem(cartKey); window.dispatchEvent(new StorageEvent("storage", { key: cartKey }));
    localStorage.removeItem(holdKey); window.dispatchEvent(new StorageEvent("storage", { key: holdKey }));
  });
  await waitFor(() => expect(screen.queryByText("查看購物車")).toBeNull());
  expect(localStorage.getItem(cartKey)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "選擇新餐點" }));
  fireEvent.click(screen.getByRole("button", { name: "加入購物車" }));
  const saved = JSON.parse(localStorage.getItem(cartKey)!);
  expect(saved).toHaveLength(1);
  expect(saved[0].menuItem.id).toBe("new");
});
