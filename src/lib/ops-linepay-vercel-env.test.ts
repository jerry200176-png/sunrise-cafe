import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const script = readFileSync(resolve(root, "scripts/ops-linepay-vercel-env.sh"), "utf8");
const workflow = readFileSync(
  resolve(root, ".github/workflows/ops-linepay-vercel-env.yml"),
  "utf8"
);

describe("LINE Pay Vercel sandbox env ops", () => {
  it("only allows the sandbox base URL mutation and never prints channel values", () => {
    expect(script).toContain("https://sandbox-api-pay.line.me");
    expect(script).toContain("MODE:-inspect");
    expect(script).toContain("shred");
    expect(script).toContain("CHANNEL_KEYS_PRESENT");
    expect(script).not.toContain("decrypt=true");
    expect(script).not.toMatch(/echo .*CHANNEL_SECRET/);
    expect(workflow).toContain("secrets.VERCEL_TOKEN");
    expect(workflow).toContain("set-sandbox-url");
    expect(workflow).toContain("chore/task-linepay-sandbox-env-20260814");
    expect(workflow).toContain("LINE_PAY_CHANNEL_(ID|SECRET)=[^[:space:]]{8,}");
    expect(workflow).not.toContain("LINE_PAY_CHANNEL_SECRET: ${{");
  });
});
