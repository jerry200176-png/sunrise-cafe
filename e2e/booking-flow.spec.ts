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

test.describe("手機訂位：選時段、同意條款、送出結果不明", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  async function goToSlotStep(page: import("@playwright/test").Page, date: string) {
    await page.goto("/book");
    await page.locator("#booking-date").fill(date);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: new RegExp(MOCK_ROOM.roomName) }).click();
    await expect(page.locator("#booking-duration")).toBeVisible();
  }

  async function mockRentalNotes(page: import("@playwright/test").Page) {
    await page.route("**/api/settings", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rental_notes: [{ title: "E2E 注意事項", items: ["請準時入場"] }],
          deposit_info: null,
          closed_dates: [],
        }),
      })
    );
  }

  test("選時段後，底部固定列直接顯示所選時段與下一步", async ({ page }) => {
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    await goToSlotStep(page, date);

    const bar = page.getByRole("region", { name: "下一步 · 填寫資料" });
    const next = bar.getByRole("button", { name: "下一步 · 填寫資料" });
    await expect(bar).toBeInViewport();
    await expect(bar).toContainText("請選擇開始時間");
    await expect(next).toBeDisabled();

    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await expect(bar).toContainText("10:00–12:00");
    await expect(bar).toContainText("共 2 小時");
    await expect(next).toBeInViewport();
    await next.click();
    await expect(page.locator("#booking-name")).toBeVisible();

    // 返回上一步：已選時段清空，固定列回到提示狀態
    await page.getByRole("button", { name: "← 重選時段" }).click();
    await expect(bar).toContainText("請選擇開始時間");
  });

  test("未勾同意也能按送出：標出錯誤並帶到勾選框，勾選後才送出", async ({ page }) => {
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    await mockRentalNotes(page);
    const posts: unknown[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/reservations") && r.method() === "POST") posts.push(r.postDataJSON());
    });
    await goToSlotStep(page, date);
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();

    await page.locator("#booking-name").fill("E2E 測試");
    await page.locator("#booking-phone").fill("0912345678");
    const submit = page.getByRole("region", { name: "確認預約" }).getByRole("button", { name: "確認預約" });
    await expect(submit).toBeEnabled();
    await submit.click();

    const agree = page.locator("#booking-agree-terms");
    await expect(page.locator("#booking-agree-terms-error")).toBeVisible();
    await expect(agree).toBeFocused();
    await expect(agree).toBeInViewport();
    await expect(agree).toHaveAttribute("aria-invalid", "true");
    expect(posts).toHaveLength(0);

    await agree.check();
    await submit.click();
    await expect(page).toHaveURL(/\/book\/success/);
    expect(posts).toHaveLength(1);
  });

  test("送出請求 contract 不變（欄位、台北時區時間、金額）", async ({ page }) => {
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    let body: Record<string, unknown> | null = null;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/reservations") && r.method() === "POST") body = r.postDataJSON();
    });
    await goToSlotStep(page, date);
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await page.locator("#booking-name").fill("E2E 測試");
    await page.locator("#booking-phone").fill("0912345678");
    await page.getByRole("button", { name: "確認預約" }).click();
    await expect(page).toHaveURL(/\/book\/success/);

    expect(body).not.toBeNull();
    const b = body as unknown as Record<string, unknown>;
    expect(Object.keys(b).sort()).toEqual(
      [
        "booking_request_key", "customer_name", "email", "end_time", "guest_count", "line_user_id",
        "meal_items", "meal_notes", "notes", "phone", "room_id", "start_time", "total_price",
      ].sort()
    );
    expect(b.start_time).toBe(new Date(`${date}T10:00:00+08:00`).toISOString());
    expect(b.end_time).toBe(new Date(`${date}T12:00:00+08:00`).toISOString());
    const day = new Date(`${date}T12:00:00+08:00`).getUTCDay();
    const hourly = day === 0 || day === 6 ? MOCK_ROOM.price_weekend : MOCK_ROOM.price_weekday;
    expect(b.total_price).toBe(hourly * 2);
    expect(b.room_id).toBe(MOCK_ROOM.roomId);
    expect(b.phone).toBe("0912345678");
  });

  test("送出中顯示狀態；逾時/斷線時告知結果不明並引導查詢，重試撞 409 時提醒可能是自己的訂位", async ({ page }) => {
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    const keys: string[] = [];
    let call = 0;
    let releaseFirst: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    await page.route("**/api/reservations", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push((route.request().postDataJSON() as { booking_request_key: string }).booking_request_key);
      call += 1;
      if (call === 1) {
        await firstHeld; // 慢網路：回應前先確認「送出中」狀態
        return route.abort("timedout");
      }
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "該時段已被預訂，請重新選擇" }),
      });
    });

    await goToSlotStep(page, date);
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await page.locator("#booking-name").fill("E2E 測試");
    await page.locator("#booking-phone").fill("0912345678");
    const submit = page.getByRole("region", { name: "確認預約" }).getByRole("button");
    await submit.click();
    await expect(submit).toHaveText("送出中…");
    await expect(submit).toBeDisabled();
    releaseFirst();

    const alert = page.getByRole("alert").filter({ hasText: "無法確認訂位是否已送出" });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("link", { name: "前往查詢我的訂位" })).toHaveAttribute("href", "/book/query");
    await expect(page).toHaveURL(/\/book$/);
    await expect(page.locator("#booking-name")).toHaveValue("E2E 測試");

    await submit.click();
    await expect(page.getByRole("alert").filter({ hasText: "可能就是您剛才送出的訂位" })).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]); // 重試沿用同一個 booking_request_key

    // 回上一步選同一時段：仍是同一筆可能已送出的訂位
    await page.getByRole("button", { name: "← 重選時段" }).click();
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await submit.click();
    await expect(page.getByRole("alert").filter({ hasText: "可能就是您剛才送出的訂位" })).toBeVisible();

    // 換不同時段：409 只代表被別人訂走
    await page.getByRole("button", { name: "← 重選時段" }).click();
    await page.getByRole("button", { name: "12:00–14:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await submit.click();
    await expect(page.getByRole("alert").filter({ hasText: "該時段已被預訂，請重新選擇" })).toBeVisible();
    await expect(page.getByRole("link", { name: "前往查詢我的訂位" })).toHaveCount(0);
  });
});

test.describe("多分店：各店注意事項／訂金說明", () => {
  test("有自己注意事項的分店顯示自己的；沒填的分店沿用全站設定", async ({ page }) => {
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    await page.route("**/api/branches", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { ...MOCK_BRANCH, rental_notes: null, deposit_info: null },
          {
            ...MOCK_BRANCH,
            id: "e2e-branch-2",
            name: "E2E 分店 B",
            rental_notes: [{ title: "B 店規則", items: ["B 店禁止外食"] }],
            deposit_info: "B 店訂金說明",
          },
        ]),
      })
    );
    await page.route("**/api/settings", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rental_notes: [{ title: "全站規則", items: ["全站請準時"] }],
          deposit_info: "全站訂金說明",
          closed_dates: [],
        }),
      })
    );

    async function reachForm(branchName: string) {
      await page.goto("/book");
      await page.getByRole("button", { name: branchName }).click();
      await page.locator("#booking-date").fill(date);
      await page.getByRole("button", { name: "下一步" }).click();
      await page.getByRole("button", { name: new RegExp(MOCK_ROOM.roomName) }).click();
      await page.locator("div.grid button:not([disabled])").first().click();
      await page.getByRole("button", { name: /下一步 · 填寫資料/ }).click();
      await expect(page.locator("#booking-name")).toBeVisible();
    }

    await reachForm("E2E 分店 B");
    await expect(page.getByText("B 店禁止外食")).toBeVisible();
    await expect(page.getByText("B 店訂金說明")).toBeVisible();
    await expect(page.getByText("全站請準時")).toHaveCount(0);

    await page.evaluate(() => sessionStorage.clear());
    await page.evaluate(() => localStorage.clear());
    await reachForm(MOCK_BRANCH.name);
    await expect(page.getByText("全站請準時")).toBeVisible();
    await expect(page.getByText("全站訂金說明")).toBeVisible();
    await expect(page.getByText("B 店禁止外食")).toHaveCount(0);
  });
});
