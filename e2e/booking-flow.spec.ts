import { test, expect } from "@playwright/test";
import {
  bookingDateOffset,
  MOCK_BRANCH,
  MOCK_ROOM,
  setupBookingApiMocks,
} from "./helpers/mock-booking";

// Side requests the booking page makes on load. Without a DB they fail and the page
// falls back to empty values; answering them here keeps that result but stops
// every test from spending the server's shared per-IP API rate limit.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/rooms?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/menu?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ preorderEnabled: false, items: [] }) })
  );
  await page.route("**/api/booking-funnel", (route) => route.fulfill({ status: 204, body: "" }));
  await page.route("**/api/payment/status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stripe_enabled: false }) })
  );
});

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
    await expect(page.getByText(/已付訂金無法線上自行取消：訂位開始前至少 48 小時/)).toBeVisible();
    await expect(page.getByText(/不足 48 小時請聯繫店員審核/)).toBeVisible();
    await page.getByLabel(/姓名/).fill("E2E 測試");
    await page.getByPlaceholder(/09/).fill("0912345678");
    await page.getByRole("button", { name: "確認預約" }).click();

    // 成功頁
    await expect(page).toHaveURL(/\/book\/success/);
    await expect(page.locator("p").filter({ hasText: /^預約申請已送出$/ })).toBeVisible();
    await expect(page.getByText("E2E001")).toBeVisible();
    await expect(page.getByText(/已付訂金無法線上自行取消：訂位開始前至少 48 小時/)).toBeVisible();
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
    // This real smoke request has its own synthetic client so earlier tests
    // cannot exhaust the shared per-IP API limit before WebKit reaches it.
    const res = await request.get("/api/version", { headers: { "x-forwarded-for": "198.51.100.42" } });
    expect(res.status()).toBe(200);
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

  for (const width of [360, 1280]) test(`未知結果鎖住同頁同時段，改選與回切均保持正確 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 740 : 800 });
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [{
      id: MOCK_ROOM.roomId, branch_id: MOCK_BRANCH.id, name: MOCK_ROOM.roomName,
      capacity: MOCK_ROOM.capacity, min_capacity: MOCK_ROOM.min_capacity,
      price_weekday: MOCK_ROOM.price_weekday, price_weekend: MOCK_ROOM.price_weekend,
    }] }));
    await page.route("**/api/branches", (route) => route.fulfill({ json: [{ ...MOCK_BRANCH, phone: "02-1234-5678" }] }));
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
      return route.abort("timedout");
    });

    await goToSlotStep(page, date);
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await page.locator("#booking-name").fill("E2E 測試");
    await page.locator("#booking-phone").fill("0912345678");
    const submit = page.getByRole("region", { name: "確認預約" }).getByRole("button");
    await page.locator("#booking-form").evaluate((form) => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await expect(submit).toHaveText("送出中…");
    await expect(submit).toBeDisabled();
    await expect.poll(() => keys.length).toBe(1);
    const guard = await page.evaluate(() => sessionStorage.getItem("sunrise_booking_submit_guard_v1"));
    expect(JSON.parse(guard ?? "null")).toHaveLength(1);
    expect(guard).not.toContain("0912345678");
    expect(guard).not.toContain("E2E 測試");
    releaseFirst();

    const alert = page.getByRole("alert").filter({ hasText: "結果尚未確認" });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("link", { name: "前往查詢我的訂位" })).toHaveAttribute("href", "/book/query");
    await expect(alert.getByRole("link", { name: "致電店家：02-1234-5678" })).toHaveAttribute("href", "tel:0212345678");
    await expect(page).toHaveURL(/\/book$/);
    await expect(page.locator("#booking-name")).toHaveValue("E2E 測試");
    await expect(submit).toBeDisabled();

    // Enter and programmatic submit both reach the handler without a second request.
    await page.locator("#booking-phone").press("Enter");
    await page.locator("#booking-form").dispatchEvent("submit");
    expect(keys).toHaveLength(1);

    // Following the suggested recovery path must not erase the tab-local guard.
    await alert.getByRole("link", { name: "前往查詢我的訂位" }).click();
    await expect(page).toHaveURL(/\/book\/query/, { timeout: 15000 });
    await page.goBack();
    await expect(page.locator("#booking-name")).toHaveValue("E2E 測試");
    await expect(submit).toBeDisabled();
    await page.reload();
    await expect(page.locator("#booking-name")).toHaveValue("E2E 測試");
    await expect(submit).toBeDisabled();
    await page.locator("#booking-form").dispatchEvent("submit");
    expect(keys).toHaveLength(1);

    // 回上一步選同一時段：仍是同一筆可能已送出的訂位
    await page.getByRole("button", { name: "← 重選時段" }).click();
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await expect(submit).toBeDisabled();
    await expect(page.getByRole("alert").filter({ hasText: "結果尚未確認" })).toBeVisible();

    // Different selection can be submitted with a distinct request key.
    await page.getByRole("button", { name: "← 重選時段" }).click();
    await page.getByRole("button", { name: "12:00–14:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await expect(page.getByRole("status").filter({ hasText: "先前另一個時段的訂位仍未確認" })).toBeVisible();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole("alert").filter({ hasText: "結果尚未確認" })).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
    await expect(submit).toBeDisabled();

    // The earlier uncertainty must survive a second unknown selection.
    await page.getByRole("button", { name: "← 重選時段" }).click();
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await expect(submit).toBeDisabled();
    await page.locator("#booking-form").dispatchEvent("submit");
    expect(keys).toHaveLength(2);
  });

  for (const response of [
    { label: "伺服器錯誤", status: 500, body: { error: "error" } },
    { label: "請求逾時", status: 408, body: { error: "timeout" } },
    { label: "成功但缺少代號", status: 200, body: { ok: true } },
    { label: "成功但代號格式錯誤", status: 200, body: { booking_code: 42 } },
  ]) {
    test(`${response.label}也視為未知且不可重送`, async ({ page }) => {
      const date = bookingDateOffset(2);
      await setupBookingApiMocks(page, date);
      let posts = 0;
      await page.route("**/api/reservations", (route) => {
        posts += 1;
        return route.fulfill({ status: response.status, json: response.body });
      });
      await goToSlotStep(page, date);
      await page.getByRole("button", { name: "10:00–12:00" }).click();
      await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
      await page.locator("#booking-name").fill("E2E 測試");
      await page.locator("#booking-phone").fill("0912345678");
      const submit = page.getByRole("region", { name: "確認預約" }).getByRole("button");
      await submit.click();
      await expect(page.getByRole("alert").filter({ hasText: "結果尚未確認" })).toBeVisible();
      await expect(submit).toBeDisabled();
      await page.locator("#booking-form").dispatchEvent("submit");
      expect(posts).toBe(1);
    });
  }

  for (const status of [400, 409]) test(`明確 ${status} 拒絕可在修正資料後重送`, async ({ page }) => {
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    let posts = 0;
    await page.route("**/api/reservations", (route) => {
      posts += 1;
      return route.fulfill({ status, json: { error: "資料不正確" } });
    });
    await goToSlotStep(page, date);
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await page.locator("#booking-name").fill("E2E 測試");
    await page.locator("#booking-phone").fill("0912345678");
    const submit = page.getByRole("region", { name: "確認預約" }).getByRole("button");
    await submit.click();
    await expect(page.getByRole("alert").filter({ hasText: "資料不正確" })).toBeVisible();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect.poll(() => posts).toBe(2);
  });

  test("分頁儲存失效時拒絕送出並提供查詢", async ({ page }) => {
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "sunrise_booking_submit_guard_v1") throw new DOMException("blocked", "SecurityError");
        return original.call(this, key, value);
      };
    });
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    let posts = 0;
    await page.route("**/api/reservations", (route) => { posts += 1; return route.abort(); });
    await goToSlotStep(page, date);
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await page.locator("#booking-name").fill("E2E 測試");
    await page.locator("#booking-phone").fill("0912345678");
    const submit = page.getByRole("region", { name: "確認預約" }).getByRole("button");
    await submit.click();
    const alert = page.getByRole("alert").filter({ hasText: "無法安全記錄" });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("link", { name: "前往查詢我的訂位" })).toHaveAttribute("href", "/book/query");
    await expect(submit).toBeDisabled();
    await page.locator("#booking-form").dispatchEvent("submit");
    expect(posts).toBe(0);
  });

  test("請求尚未回覆時重新整理仍保護原時段", async ({ page }) => {
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [{
      id: MOCK_ROOM.roomId, branch_id: MOCK_BRANCH.id, name: MOCK_ROOM.roomName,
      capacity: MOCK_ROOM.capacity, min_capacity: MOCK_ROOM.min_capacity,
      price_weekday: MOCK_ROOM.price_weekday, price_weekend: MOCK_ROOM.price_weekend,
    }] }));
    let posts = 0;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/reservations", async (route) => {
      posts += 1;
      await held;
      await route.abort("timedout").catch(() => {});
    });
    await goToSlotStep(page, date);
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await page.locator("#booking-name").fill("E2E 測試");
    await page.locator("#booking-phone").fill("0912345678");
    const submit = page.getByRole("region", { name: "確認預約" }).getByRole("button");
    await submit.click();
    await expect(submit).toHaveText("送出中…");
    await expect.poll(() => posts).toBe(1);
    await page.reload();
    release();
    await expect(page.locator("#booking-name")).toHaveValue("E2E 測試");
    await expect(submit).toBeDisabled();
    await expect(page.getByRole("alert").filter({ hasText: "結果尚未確認" })).toBeVisible();
    await page.locator("#booking-form").dispatchEvent("submit");
    expect(posts).toBe(1);
  });

  for (const status of [409, 200]) test(`留在頁面改選時段後舊請求 ${status} 不覆蓋新表單`, async ({ page }) => {
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    let release: () => void = () => {};
    let done = false;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/reservations", async (route) => {
      await pending;
      await route.fulfill({ status, json: status === 409 ? { error: "舊時段已被預約" } : { ok: true, booking_code: "E2EOLD", id: "old" } });
      done = true;
    });
    await goToSlotStep(page, date);
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await page.locator("#booking-name").fill("E2E 測試");
    await page.locator("#booking-phone").fill("0912345678");
    await page.getByRole("region", { name: "確認預約" }).getByRole("button").click();
    await page.getByRole("button", { name: "← 重選時段" }).click();
    await page.getByRole("button", { name: "12:00–14:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    release();
    await expect.poll(() => done).toBe(true);
    await expect(page).toHaveURL(/\/book$/);
    await expect(page.locator("#booking-name")).toHaveValue("E2E 測試");
    await expect(page.getByText("舊時段已被預約")).toHaveCount(0);
  });

  test("返回相同時段後舊請求的明確拒絕會解除保護", async ({ page }) => {
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [{
      id: MOCK_ROOM.roomId, branch_id: MOCK_BRANCH.id, name: MOCK_ROOM.roomName,
      capacity: MOCK_ROOM.capacity, min_capacity: MOCK_ROOM.min_capacity,
      price_weekday: MOCK_ROOM.price_weekday, price_weekend: MOCK_ROOM.price_weekend,
    }] }));
    let posts = 0;
    let releaseFirst: () => void = () => {};
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    await page.route("**/api/reservations", async (route) => {
      posts += 1;
      if (posts === 1) {
        await first;
        await route.fulfill({ status: 409, json: { error: "時段已被預約" } });
      } else {
        await route.abort("timedout").catch(() => {});
      }
    });
    await goToSlotStep(page, date);
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await page.locator("#booking-name").fill("E2E 測試");
    await page.locator("#booking-phone").fill("0912345678");
    const submit = page.getByRole("region", { name: "確認預約" }).getByRole("button");
    await submit.click();
    await expect.poll(() => posts).toBe(1);
    await page.getByRole("link", { name: "返回" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
    await page.goBack();
    await expect(page.locator("#booking-name")).toHaveValue("E2E 測試");
    await expect(submit).toBeDisabled();
    releaseFirst();
    await expect(submit).toBeEnabled();
    await expect(page.getByText("時段已被預約")).toHaveCount(0);
    await submit.click();
    await expect.poll(() => posts).toBe(2);
    await expect(page.getByRole("alert").filter({ hasText: "結果尚未確認" })).toBeVisible();
  });

  for (const firstStatus of [400, 200]) test(`離頁後舊請求 ${firstStatus} 不會清除新時段的在途保護或覆蓋草稿`, async ({ page }) => {
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [{
      id: MOCK_ROOM.roomId, branch_id: MOCK_BRANCH.id, name: MOCK_ROOM.roomName,
      capacity: MOCK_ROOM.capacity, min_capacity: MOCK_ROOM.min_capacity,
      price_weekday: MOCK_ROOM.price_weekday, price_weekend: MOCK_ROOM.price_weekend,
    }] }));
    let posts = 0;
    let firstDone = false;
    let releaseFirst: () => void = () => {};
    let releaseSecond: () => void = () => {};
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
    await page.route("**/api/reservations", async (route) => {
      posts += 1;
      if (posts === 1) {
        await first;
        await route.fulfill({ status: firstStatus, json: firstStatus === 400 ? { error: "資料不正確" } : { ok: true, booking_code: "E2EOLD", id: "old" } });
        firstDone = true;
        return;
      }
      await second;
      await route.abort("timedout").catch(() => {});
    });
    await goToSlotStep(page, date);
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    await page.locator("#booking-name").fill("E2E 測試");
    await page.locator("#booking-phone").fill("0912345678");
    await page.getByRole("region", { name: "確認預約" }).getByRole("button").click();
    await expect.poll(() => posts).toBe(1);

    // App-router navigation unmounts the first form while its request is held.
    await page.getByRole("link", { name: "返回" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
    await page.goBack();
    await expect(page.locator("#booking-name")).toHaveValue("E2E 測試");
    await page.getByRole("button", { name: "← 重選時段" }).click();
    await page.getByRole("button", { name: "12:00–14:00" }).click();
    await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
    const submit = page.getByRole("region", { name: "確認預約" }).getByRole("button");
    await submit.click();
    await expect.poll(() => posts).toBe(2);
    releaseFirst();
    await expect.poll(() => firstDone).toBe(true);
    await expect.poll(async () => page.evaluate(() => {
      const value = sessionStorage.getItem("sunrise_booking_submit_guard_v1");
      return value ? JSON.parse(value).length : 0;
    })).toBe(firstStatus === 400 ? 1 : 2);
    await expect(page).toHaveURL(/\/book$/);
    await expect(page.locator("#booking-name")).toHaveValue("E2E 測試");
    releaseSecond();
    await expect(page.getByRole("alert").filter({ hasText: "結果尚未確認" })).toBeVisible();
    await page.reload();
    await expect(page.locator("#booking-name")).toHaveValue("E2E 測試");
    await expect(submit).toBeDisabled();
    await page.locator("#booking-form").dispatchEvent("submit");
    expect(posts).toBe(2);
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
