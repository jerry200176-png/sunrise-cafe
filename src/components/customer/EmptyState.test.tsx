/** @vitest-environment jsdom */
/** @jsxImportSource react */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Search } from "lucide-react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title, description, and action CTA", () => {
    render(
      <EmptyState
        icon={Search}
        title="找不到訂位紀錄"
        description="請確認電話與代號"
        action={<a href="/book">改去訂位</a>}
      />
    );

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("找不到訂位紀錄")).toBeTruthy();
    expect(screen.getByText("請確認電話與代號")).toBeTruthy();
    expect(screen.getByRole("link", { name: "改去訂位" }).getAttribute("href")).toBe(
      "/book"
    );
  });
});
