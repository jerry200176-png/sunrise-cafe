import { expect, test } from "@playwright/test";

test("attendance confirmation opens the booking without a stored phone", async ({ page }) => {
  let submittedToken = "";
  const detail = { booking_code: "TEST01", customer_name: "測試客人", branch_name: "大安店", room_name: "會議室", start_time: "2026-11-03T04:00:00Z", end_time: "2026-11-03T06:00:00Z", lookup_token: "lookup-token" };
  await page.route("**/api/guest/confirm-attendance**", (route) => route.fulfill({ json: { ...detail, guest_confirmed_at: route.request().method() === "POST" ? "2026-11-01T00:00:00Z" : null } }));
  await page.route("**/api/my-bookings", (route) => {
    submittedToken = route.request().postDataJSON().token;
    return route.fulfill({ json: [{ id: "r1", ...detail, total_price: 1000, status: "confirmed", guest_count: 4, is_deposit_paid: true }] });
  });
  await page.goto("/book/confirm-visit?token=attendance-token");
  expect(await page.evaluate(() => sessionStorage.getItem("booking_success_phone"))).toBeNull();
  await page.getByRole("button", { name: "確認準時到店" }).click();
  await page.getByRole("link", { name: "查詢我的訂位" }).click();
  await expect(page).toHaveURL(/\/book\/query\?token=lookup-token/);
  await expect(page.getByText("TEST01")).toBeVisible();
  expect(submittedToken).toBe("lookup-token");
});
