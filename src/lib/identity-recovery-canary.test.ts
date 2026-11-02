import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("validates synthetic recovery artifact and fake API behavior offline", () => {
  const result = spawnSync("python3", ["-B", "-m", "unittest", "scripts/test_identity_recovery_canary.py"], {
    cwd: process.cwd(), env: { NODE_ENV: "test", PATH: process.env.PATH }, encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
});
