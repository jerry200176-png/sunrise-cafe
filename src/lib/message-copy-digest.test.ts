import { webcrypto, createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { isMessageCopyDigest, messageCopyDigest } from "./message-copy-digest";
afterEach(() => vi.unstubAllGlobals());
it.each(["測試\nA", "e\u0301", "é", "\ud800"])('matches server UTF-8 bytes for %s', async (text) => {
  vi.stubGlobal("crypto", webcrypto);
  expect(await messageCopyDigest(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
});
it("accepts only lowercase SHA-256 strings", () => {
  expect(isMessageCopyDigest("a".repeat(64))).toBe(true);
  for (const bad of [null, {}, "A".repeat(64), "a".repeat(63)]) expect(isMessageCopyDigest(bad)).toBe(false);
});
