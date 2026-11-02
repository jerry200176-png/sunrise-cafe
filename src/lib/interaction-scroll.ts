/** Read the current preference at each interaction; it can change while the page is open. */
function preferredBehavior(): ScrollBehavior {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "instant";
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
  } catch {
    return "instant";
  }
}

function scrollWithPreference(scroll: (behavior: ScrollBehavior) => void) {
  const behavior = preferredBehavior();
  try {
    scroll(behavior);
  } catch (error) {
    // Older engines may not accept "instant"; the current site does not set
    // CSS smooth scrolling, so "auto" is a compatible non-animated fallback.
    if (behavior !== "instant" || !(error instanceof TypeError)) throw error;
    scroll("auto");
  }
}

export function scrollIntoViewForInteraction(element: Element | null, options: Omit<ScrollIntoViewOptions, "behavior">) {
  if (!element) return;
  scrollWithPreference((behavior) => element.scrollIntoView({ ...options, behavior }));
}

export function scrollToTopForInteraction() {
  if (typeof window === "undefined") return;
  scrollWithPreference((behavior) => window.scrollTo({ top: 0, behavior }));
}
