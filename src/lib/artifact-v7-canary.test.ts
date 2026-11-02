import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("checks synthetic artifact workflow safeguards without network or credentials", () => {
  const result = spawnSync("python3", ["-B", "-m", "unittest", "scripts/test_artifact_v7_canary.py"], {
    cwd: process.cwd(),
    env: { NODE_ENV: "test", PATH: process.env.PATH },
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
});
