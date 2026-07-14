import { test, expect } from "@playwright/test";

/**
 * Forgot booking code recovery UX — phone + reservation date.
 */
test.describe("忘記訂位代號", () => {
  test("可切換日期找回，並查出訂位代號", async ({ page }) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const d = String(tomorrow.getDate()).padStart(2, "0");
    const date = `${y}-${m}-${d}`;

    await page.route("**/api/my-bookings**", async (route) => {
      const body = route.request().postDataJSON() as {
        phone?: string;
        booking_date?: string;
      };
      if (body.booking_date === date && body.phone === "0912345678") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "e2e-forgot-1",
              booking_code: "RCV001",
              room_id: "e2e-room-1",
              branch_id: "e2e-branch-1",
              room_name: "E2E 包廂 A",
              branch_name: "E2E 測試分店",
              payment_info: null,
              line_pay_url: null,
              start_time: `${date}T10:00:00+08:00`,
              end_time: `${date}T12:00:00+08:00`,
              status: "confirmed",
              total_price: 2000,
              guest_count: 4,
              customer_name: "測試",
              deposit_required: false,
              deposit_amount: null,
              is_deposit_paid: false,
              created_at: `${date}T01:00:00+08:00`,
            },
          ]),
        });
        return;
      }
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "unexpected" }),
      });
    });

    await page.goto("/book/query");
    await page.getByRole("button", { name: "忘記訂位代號？" }).click();
    await page.getByPlaceholder("輸入訂位電話").fill("0912345678");
    await page.locator("#query-booking-date").fill(date);
    await page.locator("form").getByRole("button", { name: "查詢" }).click();

    await expect(page.getByText("RCV001")).toBeVisible();
    await expect(page.getByText(/E2E 測試分店/)).toBeVisible();
  });
});
