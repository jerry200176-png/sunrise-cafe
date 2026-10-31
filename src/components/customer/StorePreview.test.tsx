// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import { mapStoreRooms, StorePreview } from "./StorePreview";

const rooms = [
  { roomId: "r1", roomName: "包廂1", available: true },
  { roomId: "r5", roomName: "會議室", available: false },
  { roomId: "rx", roomName: "未知包廂", available: true },
];

describe("whole-store guest preview", () => {
  it("maps only known Daan rooms and refuses duplicate or unknown matches", () => {
    expect(mapStoreRooms("大安店", rooms).map((r) => r.slot)).toEqual(["room1", "room5"]);
    expect(mapStoreRooms("其他分店", rooms)).toEqual([]);
    expect(mapStoreRooms("大安店", [...rooms, { roomId: "duplicate", roomName: "包廂一", available: true }]).map((r) => r.slot)).toEqual(["room5"]);
  });

  it("opens one store view and exposes keyboard-accessible room choices, including full rooms", () => {
    const onSelect = vi.fn();
    render(<LocaleProvider><StorePreview branch="大安店" rooms={rooms} selectedId={null} onSelect={onSelect} /></LocaleProvider>);
    const open = screen.getByRole("button", { name: "查看整店 3D" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(open);
    expect(screen.getByRole("button", { name: "收合整店 3D" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "會議室 · 本日已滿" }));
    expect(onSelect).toHaveBeenCalledWith("r5");
    expect(screen.queryByRole("button", { name: /未知包廂/ })).toBeNull();
  });
});
