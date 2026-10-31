import { expect, test } from "@playwright/test";
import { bookingDateOffset, mockSlotsForDate, setupBookingApiMocks } from "./helpers/mock-booking";

test("branch service failure offers retry rather than pretending there are no branches", async ({ page }) => {
  const date = bookingDateOffset(2);
  await setupBookingApiMocks(page, date);
  let attempts = 0;
  await page.route("**/api/branches", (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { error: "unavailable" } })
      : route.fulfill({ json: [{ id: "b1", name: "大安店" }] });
  });
  await page.goto("/book");
  await expect(page.getByText("無法載入分店，請重試。")).toBeVisible();
  await expect(page.getByText("尚無分店資料")).toHaveCount(0);
  await page.getByRole("button", { name: "重試", exact: true }).click();
  await expect(page.locator("#booking-date")).toBeVisible();
});

test("party size is checked before the guest chooses a room or time", async ({ page }) => {
  const date = bookingDateOffset(2);
  await setupBookingApiMocks(page, date);
  await page.goto("/book");
  await page.locator("#booking-date").fill(date);
  await page.getByRole("button", { name: "下一步" }).click();
  const count = page.getByLabel("預計人數（選填）");
  for (const invalid of ["0", "-1", "1.5", "101"]) {
    await count.fill(invalid);
    await expect(page.getByText("請輸入 1 至 100 的整數人數。")).toBeVisible();
    await expect(page.getByRole("button", { name: /E2E 包廂 A/ })).toBeDisabled();
  }
  await count.fill("9");
  const room = page.getByRole("button", { name: /E2E 包廂 A/ });
  await expect(room).toBeDisabled();
  await expect(page.getByText(/此包廂適合 2–8 人/)).toBeVisible();
  await page.getByLabel("預計人數（選填）").fill("4");
  await expect(room).toBeEnabled();
  await room.click();
  await page.getByRole("button", { name: "10:00–12:00" }).click();
  await page.getByRole("button", { name: "下一步 · 填寫資料" }).click();
  await expect(page.locator("#booking-guest-count")).toHaveValue("4");
});

test("a late availability response cannot overwrite the newly chosen date", async ({ page }) => {
  const oldDate = bookingDateOffset(2);
  const newDate = bookingDateOffset(3);
  await setupBookingApiMocks(page, oldDate);
  let releaseOld!: () => void;
  let oldStarted!: () => void;
  let oldDelivered!: () => void;
  const delivered = new Promise<void>((resolve) => { oldDelivered = resolve; });
  const waitOld = new Promise<void>((resolve) => { releaseOld = resolve; });
  const started = new Promise<void>((resolve) => { oldStarted = resolve; });
  await page.route("**/api/availability**", async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get("date") ?? oldDate;
    if (date === oldDate) { oldStarted(); await waitOld; }
    await route.fulfill({ json: { branchName: "大安店", rooms: [{ roomId: date, roomName: date === oldDate ? "舊包廂" : "新包廂", capacity: 4, price_weekday: 100, price_weekend: 120, slots: mockSlotsForDate(date) }] } });
    if (date === oldDate) oldDelivered();
  });
  await page.goto("/book");
  await page.locator("#booking-date").fill(oldDate);
  await page.getByRole("button", { name: "下一步" }).click();
  await started;
  await page.getByRole("button", { name: "← 重選日期" }).click();
  await page.locator("#booking-date").fill(newDate);
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByRole("button", { name: /新包廂/ })).toBeVisible();
  releaseOld();
  await delivered;
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  await expect(page.getByRole("button", { name: /新包廂/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /舊包廂/ })).toHaveCount(0);
});

test("waitlist offer times remain Taipei time for overseas guests", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "America/Los_Angeles" });
  const page = await context.newPage();
  await page.route("**/api/waitlist/confirm?**", (route) => route.fulfill({ json: {
    status: "notified", customer_name: "測試客人", branch_name: "大安店", room_name: "會議室",
    start_time: "2026-10-31T16:30:00Z", end_time: "2026-10-31T18:30:00Z",
  } }));
  await page.goto("/book/waitlist/confirm?token=test-token");
  await expect(page.getByText(/11\/1.*00:30–02:30/)).toBeVisible();
  await context.close();
});


test("a late room catalogue failure cannot erase current price and capacity", async ({ page }) => {
  const date = bookingDateOffset(2);
  await setupBookingApiMocks(page, date);
  let release!: () => void;
  let delivered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const sent = new Promise<void>((resolve) => { delivered = resolve; });
  await page.route("**/api/rooms?**", async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: { error: "unavailable" } });
    delivered();
  });
  await page.goto("/book");
  await page.locator("#booking-date").fill(date);
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: /E2E 包廂 A/ }).click();
  await expect(page.getByText(/預估訂金/)).toBeVisible();
  release();
  await sent;
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  await expect(page.getByText(/預估訂金/)).toBeVisible();
});

test("an empty successful availability response has a clear next step", async ({ page }) => {
  const date = bookingDateOffset(2);
  await setupBookingApiMocks(page, date);
  await page.route("**/api/availability**", (route) => route.fulfill({ json: { branchName: "大安店", rooms: [] } }));
  await page.goto("/book");
  await page.locator("#booking-date").fill(date);
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByText("這個日期目前沒有可選擇的包廂，請重選日期或聯絡店家。")).toBeVisible();
  await expect(page.getByRole("button", { name: "← 重選日期" })).toBeVisible();
});

test("a restored draft cannot submit until room price and capacity are confirmed", async ({ page }) => {
  const date = bookingDateOffset(2);
  await setupBookingApiMocks(page, date);
  await page.route("**/api/branches", (route) => route.fulfill({ json: [{ id: "b1", name: "大安店" }] }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let catalogCalls = 0;
  await page.route("**/api/rooms?**", async (route) => {
    catalogCalls++;
    if (catalogCalls === 1) { await gate; return route.fulfill({ status: 503, json: { error: "unavailable" } }); }
    if (catalogCalls === 2) return route.fulfill({ json: [null] });
    return route.fulfill({ json: [{ id: "r1", name: "包廂1", branch_id: "b1", capacity: 4, min_capacity: 2, price_weekday: 0, price_weekend: 0 }] });
  });
  let posts = 0;
  let postedTotal: number | null = null;
  await page.route("**/api/reservations", (route) => { posts++; postedTotal = route.request().postDataJSON().total_price; return route.fulfill({ json: { id: "r", booking_code: "TEST01" } }); });
  await page.addInitScript(({ day, start }) => {
    sessionStorage.setItem("sunrise_booking_draft_v1", JSON.stringify({ v: 1, savedAt: Date.now(), step: "form", branchId: "b1", branchName: "大安店", roomId: "r1", roomName: "包廂1", date: day, selectedStart: start, duration: 2, name: "測試客人", phone: "0912345678", email: "", guestCount: 5 }));
  }, { day: date, start: mockSlotsForDate(date)[0].start });
  await page.goto("/book");
  const submit = page.getByRole("button", { name: "確認預約" });
  await expect(page.getByText("正在確認包廂價格與訂金…")).toBeVisible();
  await expect(submit).toBeDisabled();
  release();
  await expect(page.getByText("無法確認包廂價格與訂金，請重試或返回選房後再送出。")).toBeVisible();
  await expect(submit).toBeDisabled();
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "重試", exact: true }).click();
  await expect.poll(() => catalogCalls).toBe(2);
  await expect(submit).toBeDisabled();
  await expect(page.getByText("無法確認包廂價格與訂金，請重試或返回選房後再送出。")).toBeVisible();
  await page.getByRole("button", { name: "重試", exact: true }).click();
  await expect(submit).toBeEnabled();
  await expect(page.getByText("預估總額")).toBeVisible();
  await expect(page.getByText("NT$ 0", { exact: true }).first()).toBeVisible();
  await submit.click();
  await expect(page.getByText("此包廂最多容納 4 人").first()).toBeVisible();
  expect(posts).toBe(0);
  await page.locator("#booking-guest-count").fill("4");
  await submit.click();
  await expect.poll(() => posts).toBe(1);
  expect(postedTotal).toBe(0);
});

test("an archived-branch draft cannot submit while active branches are being checked", async ({ page }) => {
  const date = bookingDateOffset(2);
  await setupBookingApiMocks(page, date);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/branches", async (route) => { await gate; await route.fulfill({ json: [{ id: "active", name: "大安店" }] }); });
  await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [{ id: "old-room", name: "舊包廂", branch_id: "archived", capacity: 4, price_weekday: 100, price_weekend: 120 }] }));
  let posts = 0;
  await page.route("**/api/reservations", (route) => { posts++; return route.fulfill({ json: { id: "r", booking_code: "TEST01" } }); });
  await page.addInitScript(({ day, start }) => {
    sessionStorage.setItem("sunrise_booking_draft_v1", JSON.stringify({ v: 1, savedAt: Date.now(), step: "form", branchId: "archived", branchName: "封存分店", roomId: "old-room", roomName: "舊包廂", date: day, selectedStart: start, duration: 2, name: "測試客人", phone: "0912345678", email: "", guestCount: 2 }));
  }, { day: date, start: mockSlotsForDate(date)[0].start });
  await page.goto("/book");
  await expect(page.getByRole("button", { name: "確認預約" })).toBeDisabled();
  expect(posts).toBe(0);
  release();
  await expect(page.getByText("先前選擇的分店已無法預約，請重新選擇。")).toBeVisible();
  await expect(page.locator("#booking-date")).toBeVisible();
  expect(posts).toBe(0);
});

test("malformed slot entries show an error and allow retry", async ({ page }) => {
  const date = bookingDateOffset(2);
  await setupBookingApiMocks(page, date);
  let requests = 0;
  await page.route("**/api/availability**", (route) => {
    requests++;
    return route.fulfill({ json: { branchName: "大安店", rooms: [{ roomId: "r1", roomName: "包廂1", capacity: 4, price_weekday: 100, price_weekend: 120, slots: requests === 1 ? [null] : requests === 2 ? [{ start: "invalid", end: "also-invalid", available: true }] : mockSlotsForDate(date) }] } });
  });
  await page.goto("/book");
  await page.locator("#booking-date").fill(date);
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByText("無法載入包廂空檔，請重試或重選日期")).toBeVisible();
  await page.getByRole("button", { name: "重試", exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByText("無法載入包廂空檔，請重試或重選日期")).toBeVisible();
  await page.getByRole("button", { name: "重試", exact: true }).click();
  await expect(page.getByRole("button", { name: /包廂1/ })).toBeVisible();
});


test("malformed single-room times show a retry instead of crashing", async ({ page }) => {
  const date = bookingDateOffset(2);
  await setupBookingApiMocks(page, date);
  let slotRequests = 0;
  await page.route("**/api/availability**", (route) => {
    if (new URL(route.request().url()).searchParams.has("roomId")) {
      slotRequests++;
      return route.fulfill({ json: { branchName: "大安店", roomName: "包廂1", slots: slotRequests === 1 ? [{ start: "invalid", end: "invalid", available: true }] : mockSlotsForDate(date) } });
    }
    return route.fulfill({ json: { branchName: "大安店", rooms: [{ roomId: "r1", roomName: "包廂1", capacity: 4, price_weekday: 100, price_weekend: 120, slots: mockSlotsForDate(date) }] } });
  });
  await page.goto("/book");
  await page.locator("#booking-date").fill(date);
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: /包廂1/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "無法載入時段" })).toBeVisible();
  await page.getByRole("button", { name: "重試", exact: true }).click();
  await expect(page.getByRole("button", { name: "10:00–12:00" })).toBeEnabled();
});
