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

  it("allows clicking only completed steps and ignores incomplete ones", async () => {
    const user = userEvent.setup();
    const onSelectCompletedStep = vi.fn();
    renderProgress({
      current: "slot",
      onSelectCompletedStep,
    });

    await user.click(screen.getByRole("button", { name: "分店" }));
    expect(onSelectCompletedStep).toHaveBeenCalledTimes(1);
    expect(onSelectCompletedStep).toHaveBeenCalledWith("branch");

    // current + incomplete are not buttons
    expect(screen.queryByRole("button", { name: "時段" })).toBeNull();
    expect(screen.queryByRole("button", { name: "資料" })).toBeNull();
    expect(screen.getByRole("img", { name: "時段" }).getAttribute("aria-current")).toBe(
      "step"
    );
    expect(screen.getByRole("img", { name: "資料" }).getAttribute("aria-current")).toBeNull();
  });

  it("does not fire callback when onSelectCompletedStep is omitted", () => {
    renderProgress({ current: "room" });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("img", { name: "包廂" }).getAttribute("aria-current")).toBe(
      "step"
    );
  });

  it("keeps step state correct when hideBranch omits the branch step", () => {
    const onSelectCompletedStep = vi.fn();
    renderProgress({
      current: "room",
      hideBranch: true,
      onSelectCompletedStep,
    });
    const nav = screen.getByRole("navigation", { name: "訂位步驟" });
    expect(within(nav).queryByRole("button", { name: "分店" })).toBeNull();
    expect(within(nav).getByRole("button", { name: "日期" })).toBeTruthy();
    expect(within(nav).getByRole("img", { name: "包廂" }).getAttribute("aria-current")).toBe(
      "step"
    );
    expect(within(nav).getAllByRole("img")).toHaveLength(3);
  });
});
