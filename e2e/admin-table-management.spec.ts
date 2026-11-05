import { expect, test } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

test("手機版可編輯、停用及啟用桌位，並清楚提示影響", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAdminSession(context);
  let table = { id: "11111111-1111-4111-8111-111111111111", branch_id: "b1", number: "A1", is_active: true, qr_token: "synthetic" };
  const writes: unknown[] = [];
  page.on("dialog", async (dialog) => { await dialog.accept(); });
  await page.route("**/api/branches", (route) => route.fulfill({ json: [{ id: "b1", name: "甲店" }] }));
  await page.route("**/api/admin/tables?**", (route) => route.fulfill({ json: [table] }));
  await page.route(`**/api/admin/tables/${table.id}`, async (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    if (body.expected.number !== table.number || body.expected.is_active !== table.is_active) {
      return route.fulfill({ status: 409, json: { error: "桌位已變更" } });
    }
    table = { ...table, ...(body.number !== undefined ? { number: body.number } : {}), ...(body.is_active !== undefined ? { is_active: body.is_active } : {}) };
    return route.fulfill({ json: { id: table.id, number: table.number, is_active: table.is_active } });
  });

  await page.goto("/admin/tables");
  await page.getByRole("button", { name: "編輯桌號 A1" }).click();
  await page.getByLabel("新桌號").fill("A2");
  await page.getByRole("button", { name: "儲存桌號" }).click();
  await expect(page.getByText("桌號 A2")).toBeVisible();
  await page.getByRole("button", { name: "停用桌號 A2" }).click();
  await expect(page.getByText("已停用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "啟用桌號 A2" }).click();
  await expect(page.getByText("使用中")).toBeVisible();
  expect(table.qr_token).toBe("synthetic");
  expect(writes).toEqual([
    { expected: { number: "A1", is_active: true }, number: "A2" },
    { expected: { number: "A2", is_active: true }, is_active: false },
    { expected: { number: "A2", is_active: false }, is_active: true },
  ]);
});
