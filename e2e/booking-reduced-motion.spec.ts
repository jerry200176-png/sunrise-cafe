import { expect, test } from "@playwright/test";
import { bookingDateOffset, mockSlotsForDate, MOCK_ROOM, setupBookingApiMocks } from "./helpers/mock-booking";

declare global {
  interface Window { motionEvents: Array<{ id: string; behavior?: ScrollBehavior }> }
}

test("訂位互動即時尊重減少動態偏好，保留照片與表單焦點", async ({ page }) => {
  const date = bookingDateOffset(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const state = window;
    state.motionEvents = [];
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
      if (this.id) state.motionEvents.push({ id: this.id, behavior: typeof arg === "object" ? arg.behavior : undefined });
      return scrollIntoView.call(this, arg);
    };
    const scrollTo = window.scrollTo.bind(window);
    window.scrollTo = ((arg: number | ScrollToOptions, y?: number) => {
      if (typeof arg === "object") {
        state.motionEvents.push({ id: "window", behavior: arg.behavior });
        return scrollTo(arg);
      }
      return scrollTo(arg, y ?? 0);
    }) as typeof window.scrollTo;
  });
  await setupBookingApiMocks(page, date);
  await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/availability**", (route) => {
    if (new URL(route.request().url()).searchParams.has("roomId")) {
      return route.fulfill({ json: { branchName: "大安店", roomName: "包廂1", slots: mockSlotsForDate(date), openTime: "08:00", closeTime: "22:00" } });
    }
    return route.fulfill({ json: {
      branchName: "大安店",
      rooms: ["包廂1", "包廂2", "包廂3", "包廂4", "會議室"].map((roomName, i) => ({
        roomId: `r${i}`, roomName, capacity: 8, price_weekday: 100, price_weekend: 120,
        image_url: "/banners/daan.png", slots: mockSlotsForDate(date),
      })),
    } });
  });
  await page.goto("/book");
  await page.locator("#booking-date").fill(date);
  await page.getByRole("button", { name: "下一步" }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
  await expect.poll(() => page.evaluate(() => window.motionEvents.filter((e) => e.id === "window").at(-1)?.behavior)).toBe("instant");
  await page.getByRole("button", { name: "查看整店 3D" }).click();
  // Ensure even CSS smooth scrolling cannot override the requested instant behavior.
  await page.addStyleTag({ content: "html, body { scroll-behavior: smooth !important; }" });
  // The accessible selectors use the same handler as the 3D labels and remain
  // available when a browser cannot create a WebGL context.
  const choices = page.getByLabel("選擇要查看照片的包廂");
  await choices.getByRole("button", { name: "會議室 · 可預約", exact: true }).focus();
  await page.keyboard.press("Enter");
  const meeting = page.locator("#booking-room-card-r4");
  await expect(meeting).toBeFocused();
  await expect(meeting).toBeInViewport();
  await expect(meeting.getByRole("img", { name: "會議室" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const events = window.motionEvents;
    return events.filter((e) => e.id === "booking-room-card-r4").at(-1)?.behavior;
  })).toBe("instant");
  const before = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(150);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(2);

  // A preference change takes effect without a reload; ordinary motion stays smooth.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await choices.getByRole("button", { name: "包廂1 · 可預約", exact: true }).click();
  const room = page.locator("#booking-room-card-r0");
  await expect(room).toBeFocused();
  await expect(room).toBeInViewport();
  await expect.poll(() => page.evaluate(() => {
    const events = window.motionEvents;
    return events.filter((e) => e.id === "booking-room-card-r0").at(-1)?.behavior;
  })).toBe("smooth");

  // Form validation remains focused and non-animated when the preference changes again.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await room.getByRole("button").click();
  await page.getByRole("button", { name: "10:00–12:00" }).click();
  await page.getByRole("button", { name: /下一步 · 填寫資料/ }).click();
  await page.getByRole("region", { name: "確認預約" }).getByRole("button", { name: "確認預約" }).click();
  await expect(page.locator("#booking-name")).toBeFocused();
  await expect(page.locator("#booking-name")).toBeInViewport();
  await expect.poll(() => page.evaluate(() => {
    const events = window.motionEvents;
    return events.filter((e) => e.id === "booking-name").at(-1)?.behavior;
  })).toBe("instant");
  const beforeValidation = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(150);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - beforeValidation)).toBeLessThan(2);
});

for (const scenario of [
  { status: 409, reducedMotion: "reduce" as const },
  { status: 503, reducedMotion: "no-preference" as const },
]) {
  test(`首次送出回傳 ${scenario.status} 時定位錯誤並保留客人焦點`, async ({ page }) => {
    const date = bookingDateOffset(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: scenario.reducedMotion });
    await setupBookingApiMocks(page, date);
    await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [] }));
    let release!: () => void;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    const responseGate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/reservations", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      started();
      await responseGate;
      await route.fulfill({ status: scenario.status, json: { error: `模擬錯誤 ${scenario.status}` } });
    });
    await page.goto("/book");
    await page.locator("#booking-date").fill(date);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: new RegExp(MOCK_ROOM.roomName) }).click();
    await page.getByRole("button", { name: "10:00–12:00" }).click();
    await page.getByRole("button", { name: /下一步 · 填寫資料/ }).click();
    await page.locator("#booking-name").fill("測試客人");
    const phone = page.locator("#booking-phone");
    await phone.fill("0912345678");
    await page.getByRole("region", { name: "確認預約" }).getByRole("button", { name: "確認預約" }).click();
    await requestStarted;
    await phone.focus();
    await expect(phone).toBeFocused();
    release();
    const alert = page.getByRole("alert").filter({ hasText: `模擬錯誤 ${scenario.status}` });
    await expect(alert).toBeVisible();
    await expect(alert).toBeInViewport();
    await expect(phone).toBeFocused();
  });
}
