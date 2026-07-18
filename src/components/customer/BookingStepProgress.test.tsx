/** @vitest-environment jsdom */
/** @jsxImportSource react */
import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BookingStepProgress,
  resolveVisibleCurrent,
} from "./BookingStepProgress";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";

function renderProgress(props: ComponentProps<typeof BookingStepProgress>) {
  return render(
    <LocaleProvider>
      <BookingStepProgress {...props} />
    </LocaleProvider>
  );
}

describe("resolveVisibleCurrent", () => {
  it("keeps current when visible", () => {
    expect(resolveVisibleCurrent("branch", ["branch", "date", "room"])).toBe("branch");
  });

  it("falls back to first visible when current is hidden", () => {
    expect(resolveVisibleCurrent("branch", ["date", "room", "slot", "form"])).toBe("date");
  });
});

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

    expect(screen.queryByRole("button", { name: "時段" })).toBeNull();
    expect(screen.queryByRole("button", { name: "資料" })).toBeNull();
    expect(screen.getByRole("img", { name: "時段" }).getAttribute("aria-current")).toBe(
      "step"
    );
  });

  it("does not fire callback when onSelectCompletedStep is omitted", () => {
    renderProgress({ current: "room" });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("treats hideBranch+current=branch as first visible current without completed steps", () => {
    const onSelectCompletedStep = vi.fn();
    renderProgress({
      current: "branch",
      hideBranch: true,
      onSelectCompletedStep,
    });
    const nav = screen.getByRole("navigation", { name: "訂位步驟" });
    expect(within(nav).queryByRole("button")).toBeNull();
    expect(within(nav).getByRole("img", { name: "日期" }).getAttribute("aria-current")).toBe(
      "step"
    );
  });

  it("keeps step state correct when hideBranch and current=date", () => {
    const onSelectCompletedStep = vi.fn();
    renderProgress({
      current: "date",
      hideBranch: true,
      onSelectCompletedStep,
    });
    const nav = screen.getByRole("navigation", { name: "訂位步驟" });
    expect(within(nav).queryByRole("button", { name: "分店" })).toBeNull();
    expect(within(nav).getByRole("img", { name: "日期" }).getAttribute("aria-current")).toBe(
      "step"
    );
  });
});
