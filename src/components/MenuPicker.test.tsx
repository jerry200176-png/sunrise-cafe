// @vitest-environment jsdom
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MenuPicker } from "./MenuPicker";
import type { MenuItem } from "@/types";
import type { DraftItemInput } from "@/lib/reservation-preorder";

const latte: MenuItem = {
  id: "00000000-0000-0000-0000-000000000001", branch_id: "branch", category_id: null,
  name: "拿鐵", description: null, price: 120, image_url: null, is_available: true,
  preorder_eligible: true, display_order: 0, created_at: "2026-01-01T00:00:00Z",
  options: [
    { id: "half", item_id: "item", option_group: "甜度", option_name: "半糖", price_delta: 0, display_order: 0 },
    { id: "none", item_id: "item", option_group: "甜度", option_name: "無糖", price_delta: 0, display_order: 1 },
  ],
};

it("selects a meal and keeps only one choice from each option group", async () => {
  const user = userEvent.setup();
  function Harness() {
    const [value, setValue] = useState<DraftItemInput[]>([]);
    return <><MenuPicker items={[latte]} value={value} onChange={setValue} />
      <output data-testid="selected">{JSON.stringify(value)}</output></>;
  }
  render(<Harness />);
  await user.click(screen.getByRole("checkbox", { name: "選擇拿鐵" }));
  await user.click(screen.getByRole("radio", { name: "半糖" }));
  await user.click(screen.getByRole("radio", { name: "無糖" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "拿鐵數量" }), "2");
  expect(JSON.parse(screen.getByTestId("selected").textContent ?? "[]")).toEqual([expect.objectContaining({
    menu_item_id: latte.id, quantity: 2, option_ids: ["none"],
  })]);
});

it("opens a full-screen photo on tap and closes it on tap", async () => {
  const user = userEvent.setup();
  render(<MenuPicker items={[{ ...latte, image_url: "https://x.supabase.co/latte.jpg" }]} value={[]} onChange={() => {}} />);
  await user.click(screen.getByRole("button", { name: "放大拿鐵圖片" }));
  expect(screen.getByRole("img", { name: "拿鐵" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "關閉大圖" }));
  expect(screen.queryByRole("img", { name: "拿鐵" })).toBeNull();
});

it("labels a required set and caps a multi set", async () => {
  const user = userEvent.setup();
  const item: MenuItem = { ...latte, options: [
    { id: "r1", item_id: "i", option_group: "尺寸", option_name: "大", price_delta: 0, display_order: 0, set_id: "s1", set: { min_select: 1, max_select: 1 } },
    { id: "m1", item_id: "i", option_group: "加料", option_name: "珍珠", price_delta: 10, display_order: 1, set_id: "s2", set: { min_select: 0, max_select: 2 } },
    { id: "m2", item_id: "i", option_group: "加料", option_name: "奶蓋", price_delta: 10, display_order: 2, set_id: "s2", set: { min_select: 0, max_select: 2 } },
    { id: "m3", item_id: "i", option_group: "加料", option_name: "布丁", price_delta: 10, display_order: 3, set_id: "s2", set: { min_select: 0, max_select: 2 } },
  ] };
  function Harness() {
    const [value, setValue] = useState<DraftItemInput[]>([{ menu_item_id: item.id, quantity: 1, option_ids: [], special_notes: "" }]);
    return <><MenuPicker items={[item]} value={value} onChange={setValue} /><output data-testid="selected">{JSON.stringify(value)}</output></>;
  }
  render(<Harness />);
  expect(screen.getByText("必選一個")).toBeTruthy();
  await user.click(screen.getByRole("checkbox", { name: "珍珠 +10" }));
  await user.click(screen.getByRole("checkbox", { name: "奶蓋 +10" }));
  expect((screen.getByRole("checkbox", { name: "布丁 +10" }) as HTMLInputElement).disabled).toBe(true);
  expect(JSON.parse(screen.getByTestId("selected").textContent ?? "[]")[0].option_ids).toEqual(["m1", "m2"]);
});
