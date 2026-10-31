// @vitest-environment jsdom
import { useLayoutEffect, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminMenuPage from "./page";

const mocked = vi.hoisted(() => ({
  branchState: {
    branches: [{ id: "b1", name: "甲店" }, { id: "b2", name: "乙店" }],
    loading: false, error: null as string | null, retry: vi.fn(),
  },
  fetch: vi.fn(),
}));
vi.mock("@/lib/use-admin-branches", () => ({ useAdminBranches: () => mocked.branchState }));
vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: mocked.fetch,
  readJsonWithTimeout: (response: Response) => response.json(),
}));
vi.mock("@/components/admin/OptionSetsPanel", () => ({ OptionSetsPanel: () => <div>舊店選項組</div> }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("next/image", () => ({ default: () => null }));

function Probe({ onCommit }: { onCommit: () => void }) {
  useLayoutEffect(onCommit);
  return null;
}

beforeEach(() => {
  mocked.branchState.branches = [{ id: "b1", name: "甲店" }, { id: "b2", name: "乙店" }];
  mocked.branchState.loading = false;
  mocked.branchState.error = null;
  mocked.branchState.retry.mockReset();
  mocked.fetch.mockReset();
  mocked.fetch.mockImplementation(async (url: string) => {
    if (url.includes("branchId=b2")) return new Promise<Response>(() => {});
    const data = url.includes("menu-categories")
      ? [{ id: "c1", name: "舊店分類", is_active: true }]
      : url.includes("menu-option-sets")
        ? []
        : [{ id: "i1", name: "舊店餐點", price: 80, is_available: true, display_order: 0 }];
    return new Response(JSON.stringify(data), { status: 200 });
  });
});

describe("菜單分店權限變更", () => {
  it("重新整理分店等待和失敗時遮蔽舊資料，成功後才恢復操作", async () => {
    const view = render(<AdminMenuPage />);
    await screen.findByText("舊店餐點");
    fireEvent.click(screen.getByRole("button", { name: "編輯 舊店餐點" }));
    expect(screen.getByText("編輯餐點")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新整理分店" }));
    expect(mocked.branchState.retry).toHaveBeenCalledTimes(1);

    const expectScopeBlocked = () => {
      expect(screen.queryByText("舊店餐點")).toBeNull();
      expect(screen.queryByText("舊店分類")).toBeNull();
      expect(screen.queryByText("舊店選項組")).toBeNull();
      expect(screen.queryByText("編輯餐點")).toBeNull();
      expect((screen.getByRole("button", { name: "新增餐點" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "新增分類" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByLabelText("選擇分店") as HTMLSelectElement).disabled).toBe(true);
    };

    mocked.branchState.loading = true;
    view.rerender(<AdminMenuPage />);
    expectScopeBlocked();
    expect(screen.getByText("載入分店中…")).toBeTruthy();

    mocked.branchState.loading = false;
    mocked.branchState.error = "無法載入分店";
    view.rerender(<AdminMenuPage />);
    expectScopeBlocked();
    expect(screen.getByRole("button", { name: "重試分店" })).toBeTruthy();

    mocked.branchState.error = null;
    view.rerender(<AdminMenuPage />);
    expect(screen.getByText("舊店餐點")).toBeTruthy();
    expect(screen.getByText("編輯餐點")).toBeTruthy();
    expect((screen.getByRole("button", { name: "新增餐點" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("選擇分店") as HTMLSelectElement).disabled).toBe(false);
  });

  it.each(["編輯", "刪除"])("%s 對話框在分店被移除的同次畫面提交即隱藏", async (action) => {
    const snapshots: Array<{ text: string; dialogOpen: boolean; addItemDisabled: boolean; addCategoryDisabled: boolean }> = [];
    const onCommit = () => {
      snapshots.push({
        text: document.body.textContent ?? "",
        dialogOpen: screen.queryByRole("dialog") !== null,
        addItemDisabled: (screen.getByRole("button", { name: "新增餐點" }) as HTMLButtonElement).disabled,
        addCategoryDisabled: (screen.getByRole("button", { name: "新增分類" }) as HTMLButtonElement).disabled,
      });
    };
    const view = render(<><AdminMenuPage /><Probe onCommit={onCommit} /></>);
    await screen.findByText("舊店餐點");
    fireEvent.click(screen.getByRole("button", { name: `${action} 舊店餐點` }));
    if (action === "編輯") expect(screen.getByText("編輯餐點")).toBeTruthy();
    else expect(screen.getByRole("dialog")).toBeTruthy();

    snapshots.length = 0;
    mocked.branchState.branches = [{ id: "b2", name: "乙店" }];
    view.rerender(<><AdminMenuPage /><Probe onCommit={onCommit} /></>);

    expect(snapshots.length).toBeGreaterThan(0);
    const firstCommit = snapshots[0];
    expect(firstCommit.text).not.toContain("舊店餐點");
    expect(firstCommit.text).not.toContain("舊店分類");
    expect(firstCommit.text).not.toContain("舊店選項組");
    expect(firstCommit.text).not.toContain("編輯餐點");
    expect(firstCommit.dialogOpen).toBe(false);
    expect(firstCommit.addItemDisabled).toBe(true);
    expect(firstCommit.addCategoryDisabled).toBe(true);
  });
});
