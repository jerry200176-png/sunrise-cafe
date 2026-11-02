// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollIntoViewForInteraction, scrollToTopForInteraction } from "./interaction-scroll";

afterEach(() => vi.unstubAllGlobals());

describe("interaction scrolling compatibility", () => {
  it("falls back to non-animated auto when an older browser rejects instant", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const element = document.createElement("div");
    element.scrollIntoView = vi.fn().mockImplementationOnce(() => { throw new TypeError("unsupported"); });
    scrollIntoViewForInteraction(element, { block: "center" });
    expect(element.scrollIntoView).toHaveBeenNthCalledWith(1, { block: "center", behavior: "instant" });
    expect(element.scrollIntoView).toHaveBeenNthCalledWith(2, { block: "center", behavior: "auto" });
  });

  it("defaults to non-animated scrolling when media preferences are unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    scrollToTopForInteraction();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("does not hide unrelated scrolling failures", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const element = document.createElement("div");
    element.scrollIntoView = vi.fn(() => { throw new Error("unexpected"); });
    expect(() => scrollIntoViewForInteraction(element, { block: "center" })).toThrow("unexpected");
  });
});
