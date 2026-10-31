import { expect, test } from "@playwright/test";
import { bookingDateOffset, mockSlotsForDate, setupBookingApiMocks } from "./helpers/mock-booking";

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`one whole-store preview keeps real photos and booking available on ${viewport.width}px`, async ({ page }) => {
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
          roomId: `r${i}`, roomName, capacity: 4, price_weekday: 100, price_weekend: 120, image_url: "/banners/daan.png",
          slots: mockSlotsForDate(date).map((slot, index) => ({ ...slot, available: i === 3 ? index === 0 : i !== 4 })),
        })),
      } });
    });
    await page.goto("/book");
    await page.locator("#booking-date").fill(date);
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByRole("button", { name: "查看整店 3D" })).toHaveCount(1);
    await expect(page.getByRole("img", { name: "包廂1" })).toBeVisible();
    await expect(page.getByRole("img", { name: "會議室" })).toBeAttached();
    await page.getByRole("button", { name: "查看整店 3D" }).click();
    const scene = page.locator("canvas");
    await expect(scene).toBeVisible();
    await expect(scene).toHaveAttribute("data-store-ready", "true");
    await expect(page.getByText(/尺寸、家具與裝潢僅供示意/)).toBeVisible();
    const labels = page.getByLabel("3D 圖上的包廂");
    await expect(labels.getByRole("button")).toHaveCount(5);
    for (const name of ["包廂1", "包廂2", "包廂3", "包廂4", "會議室"]) await expect(labels.getByRole("button", { name, exact: true })).toBeVisible();
    await labels.getByRole("button", { name: "包廂1", exact: true }).click();
    await expect(page.locator("#booking-room-card-r0")).toBeFocused();
    const choices = page.getByLabel("選擇要查看照片的包廂");
    await expect(choices.getByRole("button")).toHaveCount(5);
    await choices.getByRole("button", { name: "包廂4 · 沒有連續 2 小時的空檔" }).click();
    await expect(page.locator("#booking-room-card-r3").getByRole("link", { name: "加入等位清單" })).toBeVisible();
    await choices.getByRole("button", { name: "包廂2 · 可預約" }).click();
    const card = page.locator("#booking-room-card-r1");
    await expect(card).toBeFocused();
    await expect(card.getByRole("img", { name: "包廂2" })).toBeVisible();
    await expect(card).toHaveClass(/outline-amber-500/);
    await page.getByLabel("預計人數（選填）").fill("9");
    await choices.getByRole("button", { name: "會議室 · 本日已滿 · 人數不適合" }).click();
    await expect(page.locator("#booking-room-card-r4").getByRole("link", { name: "加入等位清單" })).toHaveCount(0);
    await page.getByLabel("預計人數（選填）").fill("");
    await choices.getByRole("button", { name: "會議室 · 本日已滿" }).click();
    await expect(page.locator("#booking-room-card-r4").getByRole("link", { name: "加入等位清單" })).toBeVisible();
    await scene.dispatchEvent("webglcontextlost");
    await expect(page.getByText("暫時無法顯示整店 3D，仍可透過下方照片選擇包廂。")).toBeVisible();
    await page.locator("#booking-room-card-r0").getByRole("button").click();
    await expect(page.locator("#booking-duration")).toBeVisible();
    await expect(page.getByRole("button", { name: "10:00–12:00" })).toBeEnabled();
  });
}

test("a failed store model download can be retried without leaving booking", async ({ page }) => {
  const date = bookingDateOffset(2);
  await setupBookingApiMocks(page, date);
  await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/availability**", (route) => route.fulfill({ json: {
    branchName: "大安店", rooms: [{ roomId: "r1", roomName: "包廂1", capacity: 4, price_weekday: 100, price_weekend: 120, slots: mockSlotsForDate(date) }],
  } }));
  let fail = true;
  await page.route("**/models/store/daan.glb", (route) => {
    if (fail) { fail = false; return route.fulfill({ status: 503, body: "temporary error" }); }
    return route.continue();
  });
  await page.goto("/book");
  await page.locator("#booking-date").fill(date);
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "查看整店 3D" }).click();
  await expect(page.getByText("暫時無法顯示整店 3D，仍可透過下方照片選擇包廂。")).toBeVisible();
  await page.getByRole("button", { name: "重試", exact: true }).click();
  await expect(page.locator("canvas")).toHaveAttribute("data-store-ready", "true");
});
