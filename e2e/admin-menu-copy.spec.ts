import { expect, test } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

for (const scenario of [
  { width: 390, label: "手機", fail: true },
  { width: 1440, label: "桌面", fail: false },
]) {
  test(`菜單網址複製：${scenario.label}可操作並顯示正確結果`, async ({ page, context }) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await seedAdminSession(context);
    await page.route("**/api/branches", (route) => route.fulfill({ json: [] }));
    await page.addInitScript((fail) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => fail ? Promise.reject(new Error("denied")) : Promise.resolve() },
      });
    }, scenario.fail);
    await page.goto("/admin/menu");
    const url = page.getByRole("textbox", { name: "菜單網址（可手動複製）" });
    await expect(url).toHaveValue(/\/menu$/);
    await url.focus();
    await expect(url).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "複製網址" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText(scenario.fail ? "無法自動複製，請選取菜單網址欄位後手動複製" : "已複製菜單網址")).toBeVisible();
    await expect(url).toBeVisible();
    if (scenario.width === 390) expect((await url.boundingBox())?.width).toBeGreaterThan(250);
    await expect(page.getByRole("link", { name: "開啟菜單（新分頁）" })).toHaveAttribute("href", "/menu");
  });
}
