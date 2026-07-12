#!/usr/bin/env node
/** Assumes `npm run start` already on :3000 */
import { chromium, devices } from "@playwright/test";

const BASE = "http://127.0.0.1:3000";
const MOCK_BRANCH = { id: "e2e-branch-1", name: "E2E 測試分店" };
const MOCK_ROOM = { roomId: "e2e-room-1", roomName: "E2E 包廂 A", capacity: 8, price_weekday: 800, price_weekend: 1000 };

function bookingDateOffset(days = 2) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mockSlotsForDate(date) {
  const slots = [];
  for (let h = 10; h < 18; h++) {
    const p = (n) => String(n).padStart(2, "0");
    slots.push({
      start: new Date(`${date}T${p(h)}:00:00+08:00`).toISOString(),
      end: new Date(`${date}T${p(h + 1)}:00:00+08:00`).toISOString(),
      available: true,
    });
  }
  return slots;
}

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function setupMocks(page, date) {
  const slots = mockSlotsForDate(date);
  await page.route("**/api/branches", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([MOCK_BRANCH]) })
  );
  await page.route("**/api/settings", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rental_notes: [], deposit_info: null }) })
  );
  await page.route("**/api/availability**", (r) => {
    const url = new URL(r.request().url());
    if (url.searchParams.get("roomId")) {
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ slots, roomName: MOCK_ROOM.roomName, branchName: MOCK_BRANCH.name }),
      });
    }
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ branchName: MOCK_BRANCH.name, rooms: [{ ...MOCK_ROOM, slots }] }),
    });
  });
  await page.route("**/api/reservations", (r) => {
    if (r.request().method() !== "POST") return r.continue();
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ booking_code: "MOB001" }) });
  });
}

async function goToForm(page, date) {
  await page.goto(`${BASE}/book`);
  await page.locator("#booking-date").fill(date);
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: /E2E 包廂/ }).click();
  await page.locator("div.grid button:not([disabled])").first().click();
  await page.getByRole("button", { name: /下一步 · 填寫資料/ }).click();
}

const browser = await chromium.launch();
const page = await browser.newPage({ ...devices["iPhone 13"], timezoneId: "Asia/Taipei" });
const date = bookingDateOffset(2);
await setupMocks(page, date);
await goToForm(page, date);

const sticky = page.getByRole("region", { name: "確認預約" });
const box = await sticky.boundingBox();
const vp = page.viewportSize();
record("sticky 在 iPhone 視窗內", Boolean(box && vp && box.y >= 0 && box.y + box.height <= vp.height));

await sticky.getByRole("button", { name: "確認預約" }).click();
record("空表單顯示姓名錯誤", await page.locator("#booking-name-error").isVisible());

await page.getByLabel(/姓名/).fill("測");
await page.getByPlaceholder(/09/).fill("123");
await sticky.getByRole("button", { name: "確認預約" }).click();
record("錯誤電話顯示欄位錯誤", await page.locator("#booking-phone-error").isVisible());

await page.getByPlaceholder(/09/).fill("0912345678");
await sticky.getByRole("button", { name: "確認預約" }).click();
record("正確資料到成功頁", await page.waitForURL(/success/).then(() => true).catch(() => false));

await page.route("**/api/my-bookings**", (r) =>
  r.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "m1", booking_code: "MOB002", room_name: "包廂", branch_name: "店",
      payment_info: "銀行 123", line_pay_url: null,
      start_time: new Date(`${date}T12:00:00+08:00`).toISOString(),
      end_time: new Date(`${date}T14:00:00+08:00`).toISOString(),
      status: "confirmed", deposit_required: true, deposit_amount: 500, is_deposit_paid: false,
      customer_name: "測", created_at: new Date().toISOString(),
    }]),
  })
);
await page.goto(`${BASE}/book/query`);
await page.getByPlaceholder("輸入訂位電話").fill("0912345678");
await page.getByPlaceholder("訂位代號（6 碼）").fill("MOB002");
await page.getByRole("button", { name: "查詢" }).click();
record("查詢頁付款 sticky", await page.getByRole("region", { name: /需繳納訂金/ }).isVisible({ timeout: 5000 }).catch(() => false));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
