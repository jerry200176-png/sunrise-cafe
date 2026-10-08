// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SessionGuard } from "./SessionGuard";

describe("SessionGuard", () => {
  const original = window.fetch;
  afterEach(() => {
    window.fetch = original;
  });

  it("shows a re-login prompt when an admin API call returns 401", async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 401 })) as typeof fetch;
    render(<SessionGuard />);
    expect(screen.queryByRole("alert")).toBeNull();
    await window.fetch("/api/admin/orders?branchId=b1");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("登入已過期"));
  });

  it("ignores wrong-password 401 on the login call and non-401 responses", async () => {
    window.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 500 })) as typeof fetch;
    render(<SessionGuard />);
    await window.fetch("/api/admin/login", { method: "POST" });
    await window.fetch("/api/admin/orders");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
