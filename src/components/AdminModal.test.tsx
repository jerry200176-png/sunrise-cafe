// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminModal } from "./AdminModal";

function Harness({ onBackdrop }: { onBackdrop?: () => void }) {
  const [name, setName] = useState("");
  return (
    <AdminModal open title="新增分店" onClose={() => onBackdrop?.()} error="沒存成功">
      <input aria-label="名稱" value={name} onChange={(e) => setName(e.target.value)} />
    </AdminModal>
  );
}

describe("AdminModal", () => {
  it("keeps focus in the input while typing (inline onClose re-renders every keystroke)", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("名稱");
    await waitFor(() => expect(document.activeElement).not.toBe(input));
    await userEvent.click(input);
    await userEvent.keyboard("abcdefgh");
    expect(input).toHaveProperty("value", "abcdefgh");
  });

  it("shows the error inside the dialog and ignores backdrop clicks", () => {
    const onClose = vi.fn();
    render(<Harness onBackdrop={onClose} />);
    expect(screen.getByRole("dialog")).toContain(screen.getByRole("alert"));
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
