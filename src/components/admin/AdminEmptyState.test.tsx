/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Calendar } from "lucide-react";
import { AdminEmptyState } from "./AdminEmptyState";

describe("AdminEmptyState", () => {
  it("explains the empty state and renders an optional next action", () => {
    render(
      <AdminEmptyState
        icon={Calendar}
        title="今天沒有訂位"
        description="新的訂位會出現在這裡。"
        action={<button type="button">新增訂位</button>}
      />
    );

    expect(screen.getByRole("heading", { name: "今天沒有訂位" })).toBeTruthy();
    expect(screen.getByText("新的訂位會出現在這裡。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新增訂位" })).toBeTruthy();
  });
});
