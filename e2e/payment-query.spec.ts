import { test, expect } from "@playwright/test";
import { setupMyBookingsMock } from "./helpers/mock-booking";

/**
 * Payment / deposit visibility on guest query page (#59, #53).
 * Uses mocked my-bookings — verifies UX shows payment instructions when deposit unpaid.
 */
test.describe("付款資訊（查詢頁 mock）", () => {
  test("未付訂金時顯示繳費提示與匯款資訊", async ({ page }) => {
    await setupMyBookingsMock(page);

    await page.goto("/book/query");
    await page.getByPlaceholder("輸入訂位電話").fill("0912345678");
    await page.getByPlaceholder("訂位代號（6 碼）").fill("E2E001");
    await page.getByRole("button", { name: "查詢" }).click();

    await expect(page.getByText(/需繳納訂金以完成保留/)).toBeVisible();
    await expect(page.getByText(/訂金繳費期限/)).toBeVisible();
    await expect(page.getByText("銀行：012-1234567890")).toBeVisible();
    await expect(page.getByText("E2E001")).toBeVisible();
  });
});
