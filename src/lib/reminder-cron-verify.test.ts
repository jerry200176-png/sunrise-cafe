import { describe, expect, it } from "vitest";
import { alreadyNotifiedCronMessage } from "./send-line-reminder";

/** Lightweight verify contract — full DB verify is covered via send-line reminder tests. */
describe("verify contract helpers", () => {
  it("heartbeat copy is non-empty for already notified", () => {
    expect(alreadyNotifiedCronMessage(1).length).toBeGreaterThan(10);
  });
});
