/** @vitest-environment jsdom */
/** @jsxImportSource react */
import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookingStepProgress } from "./BookingStepProgress";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";

function renderProgress(props: ComponentProps<typeof BookingStepProgress>) {
  return render(
    <LocaleProvider>
      <BookingStepProgress {...props} />
    </LocaleProvider>
  );
}

describe("BookingStepProgress", () => {
  it("marks the current step with aria-current", () => {
    renderProgress({ current: "date" });
    const current = screen.getByRole("img", { name: "日期" });
    expect(current.getAttribute("aria-current")).toBe("step");
  });

  it("allows clicking only completed steps", async () => {
    const user = userEvent.setup();
    const onSelectCompletedStep = vi.fn();
    renderProgress({
      current: "slot",
      onSelectCompletedStep,
    });

    await user.click(screen.getByRole("button", { name: "分店" }));
    expect(onSelectCompletedStep).toHaveBeenCalledWith("branch");

    expect(screen.queryByRole("button", { name: "時段" })).toBeNull();
    expect(screen.queryByRole("button", { name: "資料" })).toBeNull();
  });

  it("hides the branch step when hideBranch is set", () => {
    renderProgress({
      current: "room",
      hideBranch: true,
      onSelectCompletedStep: vi.fn(),
    });
    const nav = screen.getByRole("navigation", { name: "訂位步驟" });
    // branch hidden: date(done→button), room(current), slot, form
    expect(within(nav).queryByRole("button", { name: "分店" })).toBeNull();
    expect(within(nav).getByRole("button", { name: "日期" })).toBeTruthy();
    expect(within(nav).getByRole("img", { name: "包廂" }).getAttribute("aria-current")).toBe(
      "step"
    );
    expect(within(nav).getAllByRole("img")).toHaveLength(3);
  });
});
