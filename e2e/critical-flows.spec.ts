import { test, expect } from "@playwright/test";
import { setAdminSessionCookie } from "./helpers/admin-session";

test.describe("公開頁面", () => {
  test("首頁可載入", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("訂位查詢頁可載入", async ({ page }) => {
    await page.goto("/book/query");
    await expect(page.getByRole("heading").first()).toBeVisible();
  });

  test("後台登入頁可載入", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.locator("input[type='password']")).toBeVisible();
  });
});

test.describe("付款審核（需已登入後台）", () => {
  test("付款審核頁在登入後可開啟", async ({ page, baseURL }) => {
    await page.route("**/api/admin/payments/pending", async (route) => {
      await route.fulfill({ json: [] });
    });
    await setAdminSessionCookie(page, baseURL!);
    await page.goto("/admin/payments");
    await expect(page.getByRole("heading", { name: "付款審核" })).toBeVisible();
  });
});
