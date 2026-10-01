// @vitest-environment jsdom
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BranchMenuBanner } from "./ZoomableImage";

it("shows the 大安 banner only for the 大安 branch", () => {
  const { rerender } = render(<BranchMenuBanner branchName="昇咖啡 大安店" />);
  expect(screen.getByRole("button", { name: "放大昇咖啡大安店圖片" })).toBeTruthy();
  rerender(<BranchMenuBanner branchName="昇咖啡 桃園同德店" />);
  expect(screen.queryByRole("button")).toBeNull();
});
