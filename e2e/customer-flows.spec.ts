import { test, expect } from "@playwright/test";
import {
  mockPublicApis,
  mockReservationCreate,
  mockGuestBookingApis,
  mockWaitlistApi,
  MOCK_BOOKING_CODE,
  MOCK_BRANCH,
  MOCK_ROOM,
  e2eFutureDate,
} from "./helpers/api-mocks";
import { setAdminSessionCookie } from "./helpers/admin-session";

test.describe("Customer booking flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicApis(page);
    await mockReservationCreate(page);
  });

  test("completes booking wizard to success page", async ({ page }) => {
    const bookingDate = e2eFutureDate(7);
    await page.goto("/book");
    await expect(page.locator("#booking-date")).toBeVisible();
    await page.locator("#booking-date").fill(bookingDate);
    await page.getByRole("button", { name: /下一步|Next/ }).click();
    await page.getByRole("button", { name: MOCK_ROOM.name }).click();
    await page.getByRole("button", { name: /10:00/ }).click();
    await page.getByRole("button", { name: /下一步|Next|填寫/ }).click();
    await page.locator("#booking-name").fill("測試客人");
    await page.locator("#booking-phone").fill("0912345678");
    await page.getByRole("button", { name: /確認預約|Confirm Booking|予約を確定/ }).click();
    await expect(page).toHaveURL(/\/book\/success/);
    await expect(page.getByText(MOCK_BOOKING_CODE)).toBeVisible();
  });
});

test.describe("Booking lookup, cancellation, and reschedule", () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicApis(page);
    await mockGuestBookingApis(page);
  });

  test("looks up booking with phone and code", async ({ page }) => {
    await page.goto("/book/query");
    await page.locator("#query-phone").fill("0912345678");
    await page.locator("#query-booking-code").fill(MOCK_BOOKING_CODE);
    await page.getByRole("button", { name: /查詢|Search|検索/ }).click();
    await expect(page.getByText(MOCK_ROOM.name)).toBeVisible();
  });

  test("cancels booking after lookup", async ({ page }) => {
    await page.goto("/book/query");
    await page.locator("#query-phone").fill("0912345678");
    await page.locator("#query-booking-code").fill(MOCK_BOOKING_CODE);
    await page.getByRole("button", { name: /查詢|Search|検索/ }).click();
    await expect(page.getByText(MOCK_ROOM.name)).toBeVisible();
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /取消訂位|Cancel booking|予約をキャンセル/ }).click();
    await expect(page.getByText(MOCK_ROOM.name)).not.toBeVisible();
  });

  test("reschedules booking after lookup", async ({ page }) => {
    await page.goto("/book/query");
    await page.locator("#query-phone").fill("0912345678");
    await page.locator("#query-booking-code").fill(MOCK_BOOKING_CODE);
    await page.getByRole("button", { name: /查詢|Search|検索/ }).click();
    await expect(page.getByText(MOCK_ROOM.name)).toBeVisible();
    await page.getByRole("button", { name: /自助改期|Reschedule|日時変更/ }).click();
    await page.locator("#reschedule-date-res-mock-1").fill(e2eFutureDate(7));
    const slotButton = page
      .locator("li")
      .filter({ has: page.locator("#reschedule-date-res-mock-1") })
      .getByRole("button")
      .filter({ hasText: /\d{2}:\d{2}/ })
      .first();
    await expect(slotButton).toBeVisible();
    await slotButton.click();
    await expect(page.locator("#reschedule-date-res-mock-1")).not.toBeVisible();
  });
});

test.describe("Waitlist flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicApis(page);
    await mockWaitlistApi(page);
  });

  test("submits waitlist form", async ({ page }) => {
    const waitlistDate = e2eFutureDate(7);
    await page.goto("/book/waitlist");
    await page.locator("#waitlist-branch").selectOption(MOCK_BRANCH.id);
    await page.locator("#waitlist-room").selectOption(MOCK_ROOM.id);
    await page.locator("#waitlist-date").fill(waitlistDate);
    await page.locator("#waitlist-start-time").fill("10:00");
    await page.locator("#waitlist-end-time").fill("12:00");
    await page.locator("#waitlist-name").fill("等位測試");
    await page.locator("#waitlist-phone").fill("0912345678");
    const [waitlistResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/waitlist") && r.request().method() === "POST"
      ),
      page.locator("form button[type='submit']").click(),
    ]);
    expect(waitlistResponse.ok()).toBeTruthy();
    await expect(page).toHaveURL(/\/book\/waitlist\/success/);
  });
});

test.describe("Admin flows", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.locator("input[type='password']")).toBeVisible();
  });

  test("payments page with signed admin session", async ({ page, baseURL }) => {
    await page.route("**/api/admin/payments/pending", async (route) => {
      await route.fulfill({ json: [] });
    });
    await setAdminSessionCookie(page, baseURL!);
    await page.goto("/admin/payments");
    await expect(page.getByRole("heading", { name: "付款審核" })).toBeVisible();
  });
});
