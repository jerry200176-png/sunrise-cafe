import { test, expect } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

test("選項組：建立「必選一個」並套用到分類與餐點；餐點表單可勾選選項組", async ({ page, context }) => {
  await seedAdminSession(context);
  const branch = { id: "b1", name: "E2E 店", closed_dates: [] };
  const category = { id: "c1", branch_id: "b1", name: "飲品", display_order: 0, is_active: true };
  const item = { id: "i1", branch_id: "b1", category_id: "c1", name: "拿鐵", description: null, price: 120, image_url: null, is_available: true, preorder_eligible: true, display_order: 0, options: [], option_set_ids: [] };
  const existing = {
    id: "s1", name: "冰塊", min_select: 0, max_select: 1, mode: "optional_one", max_pick: null, display_order: 1,
    options: [{ id: "o1", name: "少冰", price_delta: 0, display_order: 0 }], item_ids: [], category_ids: [],
  };
  let posted: Record<string, unknown> | null = null;
  await page.route(/\/api\/branches(\?.*)?$/, (r) => r.fulfill({ json: [branch] }));
  await page.route("**/api/admin/menu-categories**", (r) => r.fulfill({ json: [category] }));
  await page.route("**/api/admin/menu-items**", (r) => r.fulfill({ json: [item] }));
  await page.route("**/api/admin/menu-option-sets**", async (r) => {
    if (r.request().method() === "POST") {
      posted = r.request().postDataJSON();
      return r.fulfill({ json: { ok: true, id: "s2" } });
    }
    return r.fulfill({ json: [existing] });
  });
  await page.goto("/admin/menu");
  await expect(page.getByRole("heading", { name: "選項組" })).toBeVisible();
  await expect(page.getByText("冰塊").first()).toBeVisible();

  await page.getByRole("button", { name: "新增選項組" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("名稱", { exact: true }).fill("甜度");
  await dialog.getByLabel("必選一個").check();
  await dialog.getByLabel("選項1名稱").fill("全糖");
  await dialog.getByRole("button", { name: "＋ 新增選項" }).click();
  await dialog.getByLabel("選項2名稱").fill("半糖");
  await dialog.getByLabel("選項2加價").fill("5");
  await dialog.getByLabel("飲品").check();
  await dialog.getByLabel("拿鐵").check();
  await dialog.getByRole("button", { name: "儲存" }).click();
  await expect.poll(() => posted).not.toBeNull();
  expect(posted).toMatchObject({
    branch_id: "b1", name: "甜度", mode: "required_one",
    options: [{ name: "全糖", price_delta: 0 }, { name: "半糖", price_delta: 5 }],
    category_ids: ["c1"], item_ids: ["i1"],
  });

  await page.getByLabel("編輯 拿鐵").click();
  await expect(page.getByRole("group", { name: "選項組" })).toContainText("冰塊");
});
