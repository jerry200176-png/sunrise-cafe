// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isInteractiveTarget } from "./payment-shortcuts";

describe("isInteractiveTarget", () => {
  it("keeps Enter on buttons, links and inputs away from the approve shortcut", () => {
    for (const tag of ["button", "a", "input", "textarea", "select"]) {
      expect(isInteractiveTarget(document.createElement(tag))).toBe(true);
    }
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inner = document.createElement("span");
    dialog.appendChild(inner);
    expect(isInteractiveTarget(inner)).toBe(true);
  });
  it("allows shortcuts from the page body", () => {
    expect(isInteractiveTarget(document.body)).toBe(false);
    expect(isInteractiveTarget(document.createElement("li"))).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });
});
