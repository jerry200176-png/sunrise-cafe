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
    const sticky = page.getByRole("region", { name: /需繳納訂金/ });
    await expect(sticky).toBeVisible();
    await expect(sticky.getByRole("button", { name: "我已完成轉帳" })).toBeVisible();
    await expect(page.getByText("完成轉帳後請在此回報，不需要另外通知官方 LINE。")).toBeVisible();

    await page.route("**/api/payment/report", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          duplicate: false,
          payment_event_id: "e2e-payment-event-1",
          status: "pending_review",
          message: "已收到您的匯款回報，待店家核對後會自動通知您，不需要另外傳 LINE。",
        }),
      });
    });
    await page.getByLabel("匯款帳號後五碼").fill("12345");
    await page.getByLabel("實際匯款金額").fill("1000");
    await page.getByRole("button", { name: "我已完成轉帳" }).first().click();
    await expect(page.getByText("已收到您的匯款回報，待店家核對後會自動通知您，不需要另外傳 LINE。")).toBeVisible();
  });

  test("有 LINE Pay 時 sticky bar 顯示 LINE Pay 按鈕", async ({ page }) => {
    await page.route("**/api/my-bookings**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "e2e-res-2",
            booking_code: "E2E002",
            room_id: "e2e-room-1",
            branch_id: "e2e-branch-1",
            room_name: "E2E 包廂 A",
            branch_name: "E2E 測試分店",
            payment_info: "銀行：012-1234567890",
            line_pay_url: "https://line.me/R/pay/example",
            start_time: new Date().toISOString(),
            end_time: new Date().toISOString(),
            status: "confirmed",
            total_price: 2000,
            guest_count: 4,
            customer_name: "測試",
            deposit_required: true,
            deposit_amount: 1000,
            is_deposit_paid: false,
            created_at: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/book/query");
    await page.getByPlaceholder("輸入訂位電話").fill("0912345678");
    await page.getByPlaceholder("訂位代號（6 碼）").fill("E2E002");
    await page.getByRole("button", { name: "查詢" }).click();

    const sticky = page.getByRole("region", { name: /需繳納訂金/ });
    await expect(sticky.getByRole("link", { name: /LINE Pay 付款/ })).toBeVisible();
  });
});
