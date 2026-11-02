// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADD_WARNING_KEY, createSessionAddWarningResearch } from "./session-add-warning-research";

beforeEach(() => sessionStorage.removeItem(ADD_WARNING_KEY));
afterEach(() => sessionStorage.removeItem(ADD_WARNING_KEY));

describe("anonymous per-tab warning research", () => {
  it("preserves an in-flight warning across remount and reload without storing reservation data", () => {
    const first = createSessionAddWarningResearch(sessionStorage);
    const started = first.begin();
    if (!started.ok) throw new Error("synthetic setup");
    const afterRemount = createSessionAddWarningResearch(sessionStorage);
    expect(afterRemount.snapshot()).toEqual({ ok: true, value: { version: 1, entries: [{ n: started.operation, status: "pending" }] } });
    expect(afterRemount.mark(started.operation, "unknown")).toBe(true);
    const afterReload = createSessionAddWarningResearch(sessionStorage);
    expect(afterReload.snapshot()).toEqual({ ok: true, value: { version: 1, entries: [{ n: started.operation, status: "unknown" }] } });
    expect(JSON.parse(sessionStorage.getItem(ADD_WARNING_KEY)!)).toEqual({ version: 1, entries: [{ n: started.operation, status: "unknown" }] });
  });

  it("never clears an older unknown because an unrelated request was rejected or committed", () => {
    const store = createSessionAddWarningResearch(sessionStorage);
    const old = store.begin();
    if (!old.ok) throw new Error("synthetic setup");
    expect(store.mark(old.operation, "unknown")).toBe(true);
    const second = store.begin();
    if (!second.ok) throw new Error("synthetic setup");
    expect(store.mark(second.operation, "not_attempted")).toBe(true);
    const third = store.begin();
    if (!third.ok) throw new Error("synthetic setup");
    expect(store.mark(third.operation, "committed")).toBe(true);
    expect(store.acknowledgeCommitted(third.operation)).toBe(true);
    expect(store.acknowledgeCommitted(old.operation)).toBe(false);
    expect(store.snapshot()).toEqual({ ok: true, value: { version: 1, entries: [{ n: old.operation, status: "unknown" }] } });
  });

  it("keeps confirmed commits until explicit review and refuses conflicting later callbacks", () => {
    const store = createSessionAddWarningResearch(sessionStorage);
    const started = store.begin();
    if (!started.ok) throw new Error("synthetic setup");
    expect(store.acknowledgeCommitted(started.operation)).toBe(false);
    expect(store.mark(started.operation, "committed")).toBe(true);
    expect(store.mark(started.operation, "not_attempted")).toBe(false);
    expect(store.mark(started.operation, "unknown")).toBe(false);
    expect(store.acknowledgeCommitted(started.operation)).toBe(true);
    expect(store.snapshot()).toEqual({ ok: true, value: { version: 1, entries: [] } });
  });

  it("exposes storage failures before a simulated request can be sent", () => {
    const send = vi.fn();
    const denied = createSessionAddWarningResearch({ getItem: () => { throw new Error("denied"); }, setItem: () => {} });
    if (denied.begin().ok) send();
    expect(send).not.toHaveBeenCalled();
    const quota = createSessionAddWarningResearch({ getItem: () => null, setItem: () => { throw new Error("quota"); } });
    if (quota.begin().ok) send();
    expect(send).not.toHaveBeenCalled();
    const discarded = createSessionAddWarningResearch({ getItem: () => null, setItem: () => {} });
    expect(discarded.begin()).toEqual({ ok: false });
  });

  it("does not silently replace corrupt or unexpected saved data", () => {
    sessionStorage.setItem(ADD_WARNING_KEY, JSON.stringify({ version: 1, next: 2, entries: [{ n: 1, status: "pending", unexpected: "private" }] }));
    const store = createSessionAddWarningResearch(sessionStorage);
    expect(store.snapshot()).toEqual({ ok: false });
    expect(store.begin()).toEqual({ ok: false });
    expect(sessionStorage.getItem(ADD_WARNING_KEY)).toContain("unexpected");
  });

  it("bounds storage without dropping an unresolved entry", () => {
    const store = createSessionAddWarningResearch(sessionStorage);
    for (let i = 0; i < 64; i++) expect(store.begin().ok).toBe(true);
    expect(store.begin()).toEqual({ ok: false });
    const snapshot = store.snapshot();
    expect(snapshot.ok && snapshot.value.entries).toHaveLength(64);
  });

  it("does not let a delayed response settle an operation created after storage was cleared", () => {
    const store = createSessionAddWarningResearch(sessionStorage);
    const old = store.begin();
    if (!old.ok) throw new Error("setup");
    sessionStorage.removeItem(ADD_WARNING_KEY);
    const next = store.begin();
    if (!next.ok) throw new Error("setup");
    expect(old.operation).not.toBe(next.operation);
    expect(store.mark(old.operation, "not_attempted")).toBe(false);
    expect(store.snapshot()).toEqual({ ok: true, value: { version: 1, entries: [{ n: next.operation, status: "pending" }] } });
  });

  it("does not claim protection across separate storage areas", () => {
    const independent = new Map<string, string>();
    const otherTab = createSessionAddWarningResearch({ getItem: (key) => independent.get(key) ?? null, setItem: (key, value) => { independent.set(key, value); } });
    const thisTab = createSessionAddWarningResearch(sessionStorage);
    expect(thisTab.begin().ok).toBe(true);
    expect(otherTab.snapshot()).toEqual({ ok: true, value: { version: 1, entries: [] } });
  });
});
