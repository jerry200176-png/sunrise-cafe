import { expect, test } from "@playwright/test";
import { bookingDateOffset, mockSlotsForDate, setupBookingApiMocks } from "./helpers/mock-booking";

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`room preview preserves booking on ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const date = bookingDateOffset(2);
    await setupBookingApiMocks(page, date);
    await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/availability**", (route) => {
      if (new URL(route.request().url()).searchParams.has("roomId")) {
        return route.fulfill({ json: { branchName: "大安店", roomName: "包廂1", slots: mockSlotsForDate(date), openTime: "08:00", closeTime: "22:00" } });
      }
      return route.fulfill({ json: {
        branchName: "大安店",
        rooms: ["包廂1", "包廂2", "包廂3", "包廂4", "會議室", "未知包廂"].map((roomName, i) => ({
          roomId: `r${i}`, roomName, capacity: 4, price_weekday: 100, price_weekend: 120,
          slots: mockSlotsForDate(date),
        })),
      } });
    });
    await page.goto("/book");
    await page.locator("#booking-date").fill(date);
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByRole("button", { name: /查看 3D 空間示意/ })).toHaveCount(5);
    const preview = page.getByRole("button", { name: "查看 3D 空間示意 · 包廂1" });
    await preview.click();
    await expect(page.getByText(/尺寸、家具與裝潢僅供示意/)).toBeVisible();
    await expect(page.getByRole("button", { name: "收合 3D 空間示意 · 包廂1" })).toHaveAttribute("aria-expanded", "true");
    const scene = page.locator("canvas");
    await expect(scene).toBeVisible();
    await expect(scene).toHaveAttribute("data-preview-ready", "true");
    const initial = await scene.screenshot();
    await page.getByRole("button", { name: "向左旋轉" }).click();
    await expect.poll(async () => (await scene.screenshot()).equals(initial)).toBe(false);
    await scene.dispatchEvent("webglcontextlost");
    await expect(page.getByText("暫時無法顯示立體圖，仍可使用上方包廂資訊訂位。")).toBeVisible();
    await page.getByRole("button", { name: "收合 3D 空間示意 · 包廂1" }).click();
    for (const room of ["包廂2", "包廂3", "包廂4", "會議室", "包廂1"]) {
      await page.getByRole("button", { name: `查看 3D 空間示意 · ${room}` }).click();
      await expect(page.locator("canvas")).toHaveAttribute("data-preview-ready", "true");
      await page.getByRole("button", { name: `收合 3D 空間示意 · ${room}` }).click();
    }
    await page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "查看 3D 空間示意 · 包廂1" }) }).getByRole("button").first().click();
    await expect(page.locator("#booking-duration")).toBeVisible();
    await expect(page.getByRole("button", { name: "10:00–12:00" })).toBeEnabled();
  });
}

test("a failed model download can be retried without leaving the booking page", async ({ page }) => {
  const date = bookingDateOffset(2);
  await setupBookingApiMocks(page, date);
  await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/availability**", (route) => route.fulfill({ json: {
    branchName: "大安店", rooms: [{ roomId: "r1", roomName: "包廂1", capacity: 4, price_weekday: 100, price_weekend: 120, slots: mockSlotsForDate(date) }],
  } }));
  let fail = true;
  await page.route("**/models/rooms/room1.glb", (route) => {
    if (fail) { fail = false; return route.fulfill({ status: 503, body: "temporary error" }); }
    return route.continue();
  });
  await page.goto("/book");
  await page.locator("#booking-date").fill(date);
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "查看 3D 空間示意 · 包廂1" }).click();
  await expect(page.getByText("暫時無法顯示立體圖，仍可使用上方包廂資訊訂位。")).toBeVisible();
  await page.getByRole("button", { name: "重試", exact: true }).click();
  await expect(page.locator("canvas")).toHaveAttribute("data-preview-ready", "true");
});
