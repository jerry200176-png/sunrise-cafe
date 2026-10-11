import { test, expect } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

test("分店封存：不刪資料，可從「已封存」還原", async ({ page, context }) => {
  await seedAdminSession(context);
  const active = { id: "b1", name: "E2E 大安店", closed_dates: [], created_at: "2026-01-01" };
  const archived = { id: "b2", name: "E2E 舊分店", closed_dates: [], created_at: "2026-01-01", archived_at: "2026-09-01T00:00:00Z" };
  const calls: { method: string; url: string; body: unknown }[] = [];
  await page.route("**/api/branches**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return route.fulfill({ json: req.url().includes("include=archived") ? [active, archived] : [active] });
    }
    return route.fallback();
  });
  await page.route("**/api/branches/*", async (route) => {
    const req = route.request();
    calls.push({ method: req.method(), url: req.url(), body: req.postDataJSON() });
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/admin");
  await expect(page.getByLabel("封存 E2E 大安店")).toBeVisible();
  await expect(page.getByLabel("刪除 E2E 大安店")).toHaveCount(0);
  await page.getByLabel("封存 E2E 大安店").click();
  await expect(page.getByRole("dialog")).toContainText("資料都保留".replace("資料都保留", "全部保留"));
  await page.getByRole("dialog").getByRole("button", { name: "封存" }).click();
  await expect.poll(() => calls.find((c) => c.method === "PATCH")?.body).toEqual({ archived: true });
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);

  await page.getByText("已封存的分店（1）").click();
  await page.getByRole("button", { name: "還原" }).click();
  await expect.poll(() => calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toContainEqual({ archived: false });
});
