import { test, expect } from "@playwright/test";
import {
  bookingDateOffset,
  MOCK_BRANCH,
  MOCK_ROOM,
  setupBookingApiMocks,
} from "./helpers/mock-booking";

/**
 * Guest booking journey with mocked APIs (CI-safe, no production DB).
 * Addresses #59 — verified gap: prior e2e only loaded pages.
 */
test.describe("訂位流程（API mock）", () => {
  test("客人可完成分店→日期→包廂→時段→表單→成功頁", async ({ page }) => {
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);

    await page.goto("/book");

    // 單一分店自動進入日期步驟
    await expect(page.getByLabel("選擇日期")).toBeVisible();
    await page.locator("#booking-date").fill(date);
    await page.getByRole("button", { name: "下一步" }).click();

    // 選擇包廂
    await expect(page.getByText(MOCK_ROOM.roomName)).toBeVisible();
    await page.getByRole("button", { name: new RegExp(MOCK_ROOM.roomName) }).click();

    // 選時段（第一個可預約時段；Playwright 使用 Asia/Taipei 時區）
    await expect(page.getByText("步驟 1：選擇租借時數")).toBeVisible();
    await page.locator("div.grid button:not([disabled])").first().click();
    await page.getByRole("button", { name: /下一步 · 填寫資料/ }).click();

    // 填寫表單
    await page.getByLabel(/姓名/).fill("E2E 測試");
    await page.getByPlaceholder(/09/).fill("0912345678");
    await page.getByRole("button", { name: "確認預約" }).click();

    // 成功頁
    await expect(page).toHaveURL(/\/book\/success/);
    await expect(page.getByText("預約申請已送出")).toBeVisible();
    await expect(page.getByText("E2E001")).toBeVisible();
  });

  test("多分店時可先選分店", async ({ page }) => {
    const date = bookingDateOffset(3);
    await setupBookingApiMocks(page, date);

    await page.route("**/api/branches", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          MOCK_BRANCH,
          { id: "e2e-branch-2", name: "E2E 分店 B", address: "地址 B" },
        ]),
      });
    });

    await page.goto("/book");
    await page.getByRole("button", { name: MOCK_BRANCH.name }).click();
    await expect(page.getByLabel("選擇日期")).toBeVisible();
  });
});

test.describe("CX-008 mobile form UX", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function goToFormStep(page: import("@playwright/test").Page, date: string) {
    await setupBookingApiMocks(page, date);
    await page.goto("/book");
    await page.locator("#booking-date").fill(date);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: new RegExp(MOCK_ROOM.roomName) }).click();
    await page.locator("div.grid button:not([disabled])").first().click();
    await page.getByRole("button", { name: /下一步 · 填寫資料/ }).click();
  }

  test("空表單 sticky 送出顯示姓名錯誤", async ({ page }) => {
    await goToFormStep(page, bookingDateOffset(2));
    const sticky = page.getByRole("region", { name: "確認預約" });
    await expect(sticky).toBeVisible();
    await sticky.getByRole("button", { name: "確認預約" }).click();
    await expect(page.locator("#booking-name-error")).toBeVisible();
  });
});

test.describe("公開 API smoke", () => {
  test("version 回傳 deployed 標記", async ({ request }) => {
    const res = await request.get("/api/version");
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.deployed).toBe("v2");
  });
});
