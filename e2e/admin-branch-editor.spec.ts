import { test, expect } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

/**
 * Branch editor round-trip (API mocked). Guards the multi-branch setup path:
 * saving a branch must not clear its LINE group / payment fields, and the
 * per-branch guest overrides must be sent in the documented shape.
 */
test("編輯分店：保留 LINE 群組與匯款資訊，並送出此店的注意事項／訂金說明／評論連結", async ({ page, context }) => {
  await seedAdminSession(context);
  const branch = {
    id: "e2e-branch-1",
    name: "E2E 大安店",
    display_name: "昇昇咖啡 (E2E 大安店)",
    address: "台北市",
    phone: "02-0000",
    open_time: "09:00",
    close_time: "21:00",
    closed_dates: [],
    line_group_id: "C-e2e-group",
    payment_info: "銀行：E2E 銀行",
    line_pay_url: "https://pay.example/e2e",
    rental_notes: [{ title: "E2E 規則", items: ["請準時"] }],
    deposit_info: null,
    google_review_url: null,
  };
  await page.route("**/api/branches", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([branch]) })
      : route.fallback()
  );
  let patched: Record<string, unknown> | null = null;
  await page.route(`**/api/branches/${branch.id}`, async (route) => {
    patched = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/admin");
  await page.getByTitle("編輯").first().click();

  await expect(page.getByLabel("此店租借注意事項")).toHaveValue("E2E 規則\n請準時");
  await page.getByLabel("此店 Google 評論連結").fill("https://g.page/r/e2e");
  await page.getByLabel("此店訂金說明（訂位表單顯示）").fill("E2E 店訂金說明");
  await page.screenshot({ path: test.info().outputPath("branch-editor.png"), fullPage: true });
  await page.locator("form", { has: page.locator("#branch-review-url") }).getByRole("button", { name: "儲存" }).click();

  await expect.poll(() => patched).not.toBeNull();
  expect(patched).toMatchObject({
    line_group_id: "C-e2e-group",
    payment_info: "銀行：E2E 銀行",
    line_pay_url: "https://pay.example/e2e",
    google_review_url: "https://g.page/r/e2e",
    deposit_info: "E2E 店訂金說明",
    rental_notes: [{ title: "E2E 規則", items: ["請準時"] }],
  });
});

test("編輯分店：依星期設定營業時間（同德店：週一公休、週二至週五 14–18、週末 10–18）", async ({ page, context }) => {
  await seedAdminSession(context);
  const branch = {
    id: "e2e-branch-2", name: "E2E 同德店", address: null, phone: null,
    open_time: "10:00", close_time: "18:00", closed_dates: [], weekly_hours: null,
  };
  await page.route("**/api/branches", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([branch]) })
      : route.fallback()
  );
  let patched: Record<string, unknown> | null = null;
  await page.route(`**/api/branches/${branch.id}`, async (route) => {
    patched = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/admin");
  await page.getByTitle("編輯").first().click();
  await page.getByLabel(/依星期設定營業時間/).check();
  await page.getByLabel("週一公休").check();
  await expect(page.getByLabel("週一開始")).toBeDisabled();
  for (const day of ["週二", "週三", "週四", "週五"]) {
    await page.getByLabel(`${day}開始`).fill("14:00");
  }
  await page.getByLabel("每週營業時間").screenshot({ path: test.info().outputPath("weekly-hours.png") });
  await page.locator("form", { has: page.locator("#branch-review-url") }).getByRole("button", { name: "儲存" }).click();

  await expect.poll(() => patched).not.toBeNull();
  const tueToFri = { open: "14:00", close: "18:00" };
  expect(patched!.weekly_hours).toEqual({
    mon: null, tue: tueToFri, wed: tueToFri, thu: tueToFri, fri: tueToFri,
    sat: { open: "10:00", close: "18:00" }, sun: { open: "10:00", close: "18:00" },
  });
});
