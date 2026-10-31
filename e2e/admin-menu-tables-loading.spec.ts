import { expect, test } from "@playwright/test";
import { seedAdminSession } from "./helpers/admin-session";

const branches = [{ id: "b1", name: "一店" }, { id: "b2", name: "二店" }];

test("菜單分店 503 顯示錯誤，重試成功後載入菜單", async ({ page, context }) => {
  await seedAdminSession(context);
  let attempts = 0;
  await page.route("**/api/branches", (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { error: "暫時無法載入" } })
      : route.fulfill({ json: [branches[0]] });
  });
  await page.route("**/api/admin/menu-items**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/menu-categories**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/menu-option-sets**", (route) => route.fulfill({ json: [] }));

  await page.goto("/admin/menu");
  await expect(page.getByText("暫時無法載入", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重試分店" }).click();
  await expect(page.locator("#menu-branch")).toHaveValue("b1");
  await expect(page.getByText("尚無餐點")).toBeVisible();
  expect(attempts).toBe(2);
});

test("桌位 API HTTP 錯誤顯示可重試錯誤，不顯示空桌位", async ({ page, context }) => {
  await seedAdminSession(context);
  let attempts = 0;
  await page.route("**/api/branches", (route) => route.fulfill({ json: [branches[0]] }));
  await page.route("**/api/admin/tables?**", (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { error: "桌位服務暫時無法使用" } })
      : route.fulfill({ json: [] });
  });

  await page.goto("/admin/tables");
  await expect(page.getByText("桌位服務暫時無法使用", { exact: true })).toBeVisible();
  await expect(page.getByText("尚無桌位")).toHaveCount(0);
  await page.getByRole("button", { name: "重試", exact: true }).click();
  await expect(page.getByText("尚無桌位")).toBeVisible();
});

test("桌位切店後較慢的舊回應不覆蓋新分店", async ({ page, context }) => {
  await seedAdminSession(context);
  await page.route("**/api/branches", (route) => route.fulfill({ json: branches }));
  let releaseOld!: () => void;
  const oldResponse = new Promise<void>((resolve) => { releaseOld = resolve; });
  await page.route("**/api/admin/tables?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("branchId") === "b1") {
      await oldResponse;
      return route.fulfill({ json: [{ id: "t-old", branch_id: "b1", number: "舊店桌" }] });
    }
    return route.fulfill({ json: [{ id: "t-new", branch_id: "b2", number: "新店桌" }] });
  });

  await page.goto("/admin/tables");
  await expect(page.getByText("載入桌位中…")).toBeVisible();
  await page.getByLabel("選擇分店").selectOption("b2");
  await expect(page.getByText("桌號 新店桌")).toBeVisible();
  releaseOld();
  await expect(page.getByText("桌號 新店桌")).toBeVisible();
  await expect(page.getByText("桌號 舊店桌")).toHaveCount(0);
});

test("菜單切店立即清除舊店資料並停用寫入，分店清單移除目前店後切到有效分店", async ({ page, context }) => {
  await seedAdminSession(context);
  let branchLoads = 0;
  await page.route("**/api/branches", (route) => {
    branchLoads++;
    if (branchLoads === 1) return route.fulfill({ json: branches });
    return branchLoads === 2
      ? route.fulfill({ status: 503, json: { error: "temporary" } })
      : route.fulfill({ json: [branches[1]] });
  });
  let releaseNewBranch!: () => void;
  const newBranchPending = new Promise<void>((resolve) => { releaseNewBranch = resolve; });
  await page.route("**/api/admin/menu-items?**", async (route) => {
    const branchId = new URL(route.request().url()).searchParams.get("branchId");
    if (branchId === "b1") return route.fulfill({ json: [{ id: "old-item", branch_id: "b1", name: "舊店餐點", price: 10, is_available: true }] });
    await newBranchPending;
    return route.fulfill({ json: [{ id: "new-item", branch_id: "b2", name: "新店餐點", price: 20, is_available: true }] });
  });
  await page.route("**/api/admin/menu-categories?**", async (route) => {
    const branchId = new URL(route.request().url()).searchParams.get("branchId");
    if (branchId === "b1") return route.fulfill({ json: [{ id: "old-category", branch_id: "b1", name: "舊店分類", is_active: true }] });
    await newBranchPending;
    return route.fulfill({ json: [{ id: "new-category", branch_id: "b2", name: "新店分類", is_active: true }] });
  });
  await page.route("**/api/admin/menu-option-sets?**", async (route) => {
    const branchId = new URL(route.request().url()).searchParams.get("branchId");
    if (branchId === "b1") return route.fulfill({ json: [] });
    await newBranchPending;
    return route.fulfill({ json: [] });
  });

  await page.goto("/admin/menu");
  await expect(page.getByText("舊店餐點")).toBeVisible();
  await expect(page.getByText("舊店分類")).toBeVisible();
  await page.getByLabel("選擇分店").selectOption("b2");
  await expect(page.getByText("舊店餐點")).toHaveCount(0);
  await expect(page.getByText("舊店分類")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新增餐點" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "新增分類" })).toBeDisabled();
  await expect(page.getByText("載入中…")).toBeVisible();
  releaseNewBranch();
  await expect(page.getByText("新店餐點")).toBeVisible();

  await page.getByLabel("選擇分店").selectOption("b1");
  await expect(page.getByText("舊店餐點")).toBeVisible();
  await page.getByRole("button", { name: "重新整理分店" }).click();
  await expect(page.getByText("系統暫時有問題，請稍後再試", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重試分店" }).click();
  await expect(page.getByLabel("選擇分店")).toHaveValue("b2");
  await expect(page.getByText("新店餐點")).toBeVisible();
  expect(branchLoads).toBe(3);
});
