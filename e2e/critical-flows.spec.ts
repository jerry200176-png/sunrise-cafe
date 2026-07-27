import { test, expect } from "@playwright/test";

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

test.describe("後台（需已登入）", () => {
  test.skip(!process.env.E2E_ADMIN_PASSWORD, "需設定 E2E_ADMIN_PASSWORD");

  async function loginAdmin(page: import("@playwright/test").Page) {
    await page.goto("/admin/login");
    await page.locator("input[type='password']").fill(process.env.E2E_ADMIN_PASSWORD!);
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/admin" || url.pathname.startsWith("/admin/")),
      page.getByRole("button", { name: /登入/ }).click(),
    ]);
    // Ensure we left the login screen (cookie set) before navigating further.
    await expect(page).not.toHaveURL(/\/admin\/login$/);
  }

  test("付款審核頁在登入後可開啟", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/payments");
    await expect(page.getByRole("heading", { name: "付款審核" })).toBeVisible();
  });

  test("Executive 儀表板在登入後可開啟", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/executive");
    await expect(page.getByText(/營運風險|Executive|訂金率/).first()).toBeVisible();
  });
});
