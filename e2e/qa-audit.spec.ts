/**
 * Multi-persona QA audit — desktop + mobile viewports.
 * Run: npm run build && PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/qa-audit.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import {
  bookingDateOffset,
  MOCK_BRANCH,
  MOCK_ROOM,
  setupBookingApiMocks,
} from "./helpers/mock-booking";

type Viewport = { name: string; width: number; height: number };

const VIEWPORTS: Viewport[] = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
];

type Finding = { persona: string; viewport: string; page: string; severity: string; issue: string };

const findings: Finding[] = [];

function record(
  persona: string,
  viewport: string,
  page: string,
  severity: "critical" | "major" | "minor" | "cosmetic",
  issue: string
) {
  findings.push({ persona, viewport, page, severity, issue });
}

async function checkHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 2;
  });
  if (overflow) {
    return `水平溢出（${label}）：內容寬於視窗`;
  }
  return null;
}

async function checkSmallTapTargets(page: Page, minPx = 44) {
  return page.evaluate((min) => {
    const bad: string[] = [];
    document.querySelectorAll("button, a, [role='button']").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      if (rect.width < min || rect.height < min) {
        const text = (el.textContent || "").trim().slice(0, 30);
        bad.push(`「${text || el.getAttribute("aria-label") || "control"}」${Math.round(rect.width)}×${Math.round(rect.height)}px`);
      }
    });
    return bad.slice(0, 5);
  }, minPx);
}

async function checkUnreadableText(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    document.querySelectorAll("p, span, label, h1, h2, h3, button").forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      const fs = parseFloat(style.fontSize);
      if (fs > 0 && fs < 11) {
        issues.push(`字體過小 ${fs}px: "${(el.textContent || "").trim().slice(0, 20)}"`);
      }
    });
    return issues.slice(0, 3);
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`QA — ${vp.name} (${vp.width}×${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("客人：首頁", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByText("昇咖啡").first()).toBeVisible();
      const overflow = await checkHorizontalOverflow(page, "首頁");
      if (overflow) record("客人", vp.name, "/", "major", overflow);
      const small = await checkSmallTapTargets(page);
      small.forEach((s) => record("客人", vp.name, "/", "minor", `觸控目標偏小: ${s}`));
    });

    test("客人：訂位流程到表單", async ({ page }) => {
      const date = bookingDateOffset(2);
      await setupBookingApiMocks(page, date);
      await page.goto("/book");
      await page.locator("#booking-date").fill(date);
      await page.getByRole("button", { name: "下一步" }).click();
      await page.getByRole("button", { name: new RegExp(MOCK_ROOM.roomName) }).click();
      await page.locator("div.grid button:not([disabled])").first().click();
      await page.getByRole("button", { name: /下一步 · 填寫資料/ }).click();
      await expect(page.locator("#booking-name")).toBeVisible();
      const overflow = await checkHorizontalOverflow(page, "訂位表單");
      if (overflow) record("客人", vp.name, "/book", "major", overflow);
      if (vp.name === "mobile") {
        const sticky = page.getByRole("region", { name: "確認預約" });
        await expect(sticky).toBeVisible();
        const box = await sticky.boundingBox();
        if (box && box.y < vp.height - 120) {
          record("客人", vp.name, "/book", "minor", "sticky 送出列可能未貼底");
        }
      }
    });

    test("客人：查詢頁", async ({ page }) => {
      await page.goto("/book/query");
      await expect(page.getByRole("heading").first()).toBeVisible();
      const overflow = await checkHorizontalOverflow(page, "查詢頁");
      if (overflow) record("客人", vp.name, "/book/query", "major", overflow);
    });

    test("客人：候補頁", async ({ page }) => {
      await page.goto("/book/waitlist");
      await expect(page.locator("body")).toBeVisible();
      const overflow = await checkHorizontalOverflow(page, "候補");
      if (overflow) record("客人", vp.name, "/book/waitlist", "major", overflow);
    });

    test("店員：後台登入", async ({ page }) => {
      await page.goto("/admin/login");
      await expect(page.locator("input[type='password']")).toBeVisible();
      const overflow = await checkHorizontalOverflow(page, "後台登入");
      if (overflow) record("店員", vp.name, "/admin/login", "major", overflow);
      const small = await checkSmallTapTargets(page);
      small.forEach((s) => record("店員", vp.name, "/admin/login", "minor", `觸控目標偏小: ${s}`));
    });

    test("店員：後台首頁（未登入應導向）", async ({ page }) => {
      await page.goto("/admin");
      await page.waitForURL(/\/(admin\/login|admin)/);
      const overflow = await checkHorizontalOverflow(page, "後台");
      if (overflow) record("店員", vp.name, "/admin", "major", overflow);
    });

    test("店員：儀表板頁殼", async ({ page }) => {
      await page.goto("/admin/dashboard");
      await page.waitForURL(/\/(admin\/login|admin\/dashboard)/);
      const overflow = await checkHorizontalOverflow(page, "儀表板");
      if (overflow) record("店員", vp.name, "/admin/dashboard", "major", overflow);
    });
  });
}

test.afterAll(async () => {
  if (findings.length > 0) {
    console.log("\n=== QA FINDINGS ===");
    for (const f of findings) {
      console.log(`[${f.severity}] ${f.persona} / ${f.viewport} / ${f.page}: ${f.issue}`);
    }
    console.log(`Total: ${findings.length}`);
  } else {
    console.log("\n=== QA: No automated layout findings ===");
  }
});
