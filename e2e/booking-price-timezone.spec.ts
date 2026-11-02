import { expect, test } from "@playwright/test";

// Exercise the real guest UI in an overseas device timezone; all APIs below are
// synthetic and any other network destination is blocked for this spec.
test.use({ timezoneId: "America/Los_Angeles" });

function futureFriday(): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 7 + ((5 - day.getUTCDay() + 7) % 7));
  return day.toISOString().slice(0, 10);
}

function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

for (const scenario of [
  { name: "台北週五白天", overnight: false, time: "10:00", range: "10:00–12:00", total: 1600 },
  { name: "週五營業視圖跨到台北週六", overnight: true, time: "01:00", range: "01:00–03:00", total: 2000 },
]) {
  test(`${scenario.name}：LA 裝置顯示及送出對應日期與價格`, async ({ page }) => {
    const calendarDate = futureFriday();
    const startDate = scenario.overnight ? nextDay(calendarDate) : calendarDate;
    const start = new Date(`${startDate}T${scenario.time}:00+08:00`);
    const expectedEnd = new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const slots = Array.from({ length: 4 }, (_, i) => ({
      start: new Date(start.getTime() + i * 30 * 60 * 1000).toISOString(),
      end: new Date(start.getTime() + (i + 1) * 30 * 60 * 1000).toISOString(),
      available: true,
    }));
    const branch = { id: "test-branch", name: "測試店", open_time: "00:00", close_time: "23:59" };
    const room = { roomId: "test-room", roomName: "測試房", capacity: 8, price_weekday: 800, price_weekend: 1000, slots };
    const unexpected: string[] = [];
    const posts: unknown[] = [];

    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return route.abort();
      if (url.pathname.startsWith("/api/")) {
        unexpected.push(`${route.request().method()} ${url.pathname}`);
        return route.fulfill({ status: 418, json: { error: "Unexpected test API" } });
      }
      return route.continue();
    });
    await page.route("**/api/branches", (route) => route.fulfill({ json: [branch] }));
    await page.route("**/api/settings", (route) => route.fulfill({ json: { rental_notes: [], closed_dates: [] } }));
    await page.route("**/api/rooms?**", (route) => route.fulfill({ json: [{ id: room.roomId, branch_id: branch.id, name: room.roomName, capacity: room.capacity, price_weekday: room.price_weekday, price_weekend: room.price_weekend }] }));
    await page.route("**/api/menu?**", (route) => route.fulfill({ json: { preorderEnabled: false, items: [] } }));
    await page.route("**/api/payment/status", (route) => route.fulfill({ json: { stripe_enabled: false } }));
    await page.route("**/api/booking-funnel", (route) => route.fulfill({ status: 204, body: "" }));
    await page.route("**/api/availability**", (route) => route.fulfill({ json: new URL(route.request().url()).searchParams.has("roomId")
      ? { roomName: room.roomName, branchName: branch.name, slots }
      : { branchName: branch.name, rooms: [room] } }));
    await page.route("**/api/reservations", async (route) => {
      if (route.request().method() !== "POST") return route.fulfill({ status: 405, body: "" });
      posts.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: { error: "合成測試：未建立訂位" } });
    });

    await page.goto("/book");
    await page.getByLabel("選擇日期").fill(calendarDate);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: /測試房/ }).click();
    await page.getByRole("button", { name: scenario.range, exact: true }).click();
    await page.getByRole("region", { name: "下一步 · 填寫資料" }).getByRole("button").click();
    await expect(page.getByText(`NT$ ${scenario.total.toLocaleString()}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`NT$ ${(scenario.total / 2).toLocaleString()}`, { exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(`${startDate}.*${scenario.range}`))).toBeVisible();
    await page.locator("#booking-name").fill("測試客人");
    await page.locator("#booking-phone").fill("0900000000");
    await page.getByRole("region", { name: "確認預約" }).getByRole("button").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ start_time: start.toISOString(), end_time: expectedEnd, total_price: scenario.total });
    await expect(page.getByRole("alert").filter({ hasText: "合成測試：未建立訂位" })).toBeVisible();
    expect(unexpected).toEqual([]);
  });
}
