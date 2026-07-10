import { describe, it, expect } from "vitest";
import {
  createLineOAuthState,
  verifyLineOAuthState,
  createLineBindCookieValue,
  verifyLineBindCookie,
} from "./line-oauth";

const SECRET = "test-line-oauth-secret";
const LINE_UID = "U1234567890abcdef1234567890abcdef";

describe("LINE OAuth state", () => {
  it("creates and verifies signed state", async () => {
    const token = await createLineOAuthState({ mode: "prebooking" }, SECRET);
    const payload = await verifyLineOAuthState(token, SECRET);
    expect(payload?.mode).toBe("prebooking");
  });

  it("rejects tampered state", async () => {
    const token = await createLineOAuthState({ mode: "prebooking" }, SECRET);
    const tampered = token.slice(0, -4) + "xxxx";
    expect(await verifyLineOAuthState(tampered, SECRET)).toBeNull();
  });

  it("includes booking_code for post_booking mode", async () => {
    const token = await createLineOAuthState(
      { mode: "post_booking", booking_code: "ABC123" },
      SECRET
    );
    const payload = await verifyLineOAuthState(token, SECRET);
    expect(payload?.booking_code).toBe("ABC123");
  });
});

describe("LINE bind cookie", () => {
  it("round-trips valid user id", async () => {
    const cookie = await createLineBindCookieValue(LINE_UID, SECRET);
    expect(await verifyLineBindCookie(cookie, SECRET)).toBe(LINE_UID);
  });

  it("rejects invalid user id format", async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ uid: "not-line-id", exp: now + 3600 });
    const encoded = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
    const bytes = new Uint8Array(sigBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const sig = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyLineBindCookie(`${encoded}.${sig}`, SECRET)).toBeNull();
  });
});
