// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import { RoomPreview, previewRoomForBranch } from "./RoomPreview";

vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="scene" /> }));

describe("guest room previews", () => {
  it("matches all five rooms by explicit name and never guesses unknown rooms or branches", () => {
    expect(["包廂1", "包廂二", "包廂３", "包廂 4", "會議室"].map((name) => previewRoomForBranch("大安店", name)?.slot))
      .toEqual(["room1", "room2", "room3", "room4", "room5"]);
    expect(previewRoomForBranch("大安店", "其他包廂")).toBeNull();
    expect(previewRoomForBranch("信義店", "包廂1")).toBeNull();
    expect(previewRoomForBranch("大安第二分店", "包廂1")).toBeNull();
    expect(previewRoomForBranch("昇咖啡 大安店", "包廂1")?.slot).toBe("room1");
  });

  it("keeps the view optional and clearly describes its limitations", () => {
    const onToggle = vi.fn();
    const view = render(<LocaleProvider><RoomPreview branch="大安店" room="包廂1" open={false} onToggle={onToggle} /></LocaleProvider>);
    const button = screen.getByRole("button", { name: /查看 3D/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("scene")).toBeNull();
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
    view.rerender(<LocaleProvider><RoomPreview branch="大安店" room="包廂1" open onToggle={onToggle} /></LocaleProvider>);
    expect(screen.getByText(/僅供示意/)).toBeTruthy();
    expect(screen.getByTestId("scene")).toBeTruthy();
  });
});
