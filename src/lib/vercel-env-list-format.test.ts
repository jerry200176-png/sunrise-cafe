import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const parser = resolve(__dirname, "../../scripts/parse-vercel-env-list.py");
function parse(input: string) {
  return spawnSync("python3", [parser], { input, encoding: "utf8" });
}

describe("Vercel environment list format", () => {
  it("emits names only for the known table format", () => {
    const result = parse("name value type environments created\nLINE_PAY_CHANNEL_ID fake-sensitive-value Secret production 1d\n");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("LINE_PAY_CHANNEL_ID");
    expect(result.stdout + result.stderr).not.toContain("fake-sensitive-value");
  });

  it.each([
    "",
    "name value type environments created\n",
    "unexpected heading\nLINE_PAY_CHANNEL_ID fake-sensitive-value Secret production 1d\n",
    "name value type environments created\nLINE_PAY_CHANNEL_ID fake-sensitive-value\n",
    "name value type environments created\ninvalid-key fake-sensitive-value Secret production 1d\n",
  ])("rejects an empty, incomplete or unrecognized table", (input) => {
    const result = parse(input);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain("fake-sensitive-value");
  });
});
