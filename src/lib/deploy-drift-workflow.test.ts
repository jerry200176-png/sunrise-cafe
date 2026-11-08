import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
let directory = "";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fixture(): string {
  directory = mkdtempSync(path.join(tmpdir(), "deploy-drift-test-"));
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Drift test");
  mkdirSync(path.join(directory, "scripts"));
  for (const file of ["vercel-ignored-build.sh", "classify-deploy-drift.py"]) {
    copyFileSync(path.join(root, "scripts", file), path.join(directory, "scripts", file));
  }
  mkdirSync(path.join(directory, "src"));
  mkdirSync(path.join(directory, "docs"));
  writeFileSync(path.join(directory, "src/app.ts"), "original\n");
  git("add", ".");
  git("commit", "-qm", "baseline");
  return git("rev-parse", "HEAD");
}

function commit(file: string, contents: string, date?: string): string {
  writeFileSync(path.join(directory, file), contents);
  git("add", "-A");
  execFileSync("git", ["commit", "-qm", "change"], { cwd: directory,
    env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
    stdio: "pipe" });
  return git("rev-parse", "HEAD");
}

function classify(production: string, main: string) {
  const result = spawnSync("python3", ["scripts/classify-deploy-drift.py", production, main], {
    cwd: directory,
    encoding: "utf8",
  });
  return { status: result.status, value: result.stdout.trim() };
}

function runWorkflow(production: string, main: string, openIssue: string, currentMain = main) {
  const bin = path.join(directory, "fake-bin");
  mkdirSync(bin);
  const calls = path.join(directory, "calls");
  writeFileSync(calls, "");
  const commands: Record<string, string> = {
    gh: `#!/bin/bash
if [[ "$1 $2" == "issue list" ]]; then printf '%s\\n' "$FAKE_OPEN"; exit 0; fi
if [[ "$1" == "api" && "$2" == */commits/main ]]; then printf '%s\\n' "$FAKE_CURRENT_MAIN"; exit 0; fi
if [[ "$1" == "api" && "$2" == */commits/* ]]; then printf '2020-01-01T00:00:00Z\\n'; exit 0; fi
printf '%s\\n' "$*" >> "$FAKE_CALLS"
`,
    curl: "#!/bin/bash\nprintf '%s\\n' \"$FAKE_PRODUCTION\"\n",
    jq: "#!/bin/bash\ncat\n",
  };
  for (const [name, contents] of Object.entries(commands)) {
    const target = path.join(bin, name);
    writeFileSync(target, contents);
    chmodSync(target, 0o755);
  }
  const workflow = readFileSync(path.join(root, ".github/workflows/deploy-drift.yml"), "utf8");
  const step = workflow.split("      - name: Compare production with main\n")[1]?.split("        run: |\n")[1];
  if (!step) throw new Error("comparison step missing");
  const script = step.split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
  const result = spawnSync("bash", ["-c", script], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MAIN_SHA: main,
      GH_REPO: "test/repo", PRODUCTION_URL: "https://example.invalid", GITHUB_SERVER_URL: "https://github.com",
      GITHUB_RUN_ID: "1", FAKE_PRODUCTION: production, FAKE_OPEN: openIssue,
      FAKE_CURRENT_MAIN: currentMain, FAKE_CALLS: calls },
  });
  return { status: result.status, calls: readFileSync(calls, "utf8") };
}

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
});

describe("deployment drift classification", () => {
  it("treats the exact version and documentation-only differences as healthy", () => {
    const production = fixture();
    expect(classify(production, production)).toEqual({ status: 0, value: "exact" });
    const main = commit("docs/change.md", "documentation\n");
    expect(classify(production, main)).toEqual({ status: 0, value: "benign" });
  });

  it("checks the full range, even when the latest commit is documentation", () => {
    const production = fixture();
    commit("src/app.ts", "runtime change\n");
    const main = commit("docs/change.md", "documentation\n");
    expect(classify(production, main)).toEqual({ status: 0, value: "actionable" });
  });

  it("detects a runtime file moved to an ignored path", () => {
    const production = fixture();
    git("mv", "src/app.ts", "docs/app.md");
    git("commit", "-qm", "move runtime");
    expect(classify(production, git("rev-parse", "HEAD"))).toEqual({ status: 0, value: "actionable" });
  });

  it("does not mark missing or non-ancestor production revisions healthy", () => {
    const production = fixture();
    const main = commit("docs/change.md", "documentation\n");
    expect(classify("0".repeat(40), main)).toEqual({ status: 1, value: "unknown" });
    expect(classify(main, production)).toEqual({ status: 0, value: "actionable" });
  });

  it("treats a verified empty commit as benign", () => {
    const production = fixture();
    git("commit", "--allow-empty", "-qm", "empty");
    expect(classify(production, git("rev-parse", "HEAD"))).toEqual({ status: 0, value: "benign" });
  });

  it("closes an existing alert only after confirming documentation-only drift", () => {
    const production = fixture();
    const main = commit("docs/change.md", "documentation\n");
    const result = runWorkflow(production, main, "42");
    expect(result.status).toBe(0);
    expect(result.calls).toMatch(/issue close 42/);
  });

  it("opens an alert for an old runtime difference", () => {
    const production = fixture();
    const main = commit("src/app.ts", "runtime change\n", "2020-01-01T00:00:00Z");
    const result = runWorkflow(production, main, "");
    expect(result.status).toBe(0);
    expect(result.calls).toMatch(/issue create/);
  });

  it("does not let a fresh documentation commit hide an old runtime change", () => {
    const production = fixture();
    commit("src/app.ts", "runtime change\n", "2020-01-01T00:00:00Z");
    const main = commit("docs/change.md", "fresh documentation\n");
    const result = runWorkflow(production, main, "");
    expect(result.status).toBe(0);
    expect(result.calls).toMatch(/issue create/);
  });

  it("grants the release grace period to a recent runtime change after old docs", () => {
    const production = fixture();
    commit("docs/change.md", "old documentation\n", "2020-01-01T00:00:00Z");
    const main = commit("src/app.ts", "recent runtime change\n");
    expect(runWorkflow(production, main, "")).toEqual({ status: 0, calls: "" });
  });

  it("does not grant grace when production is not an ancestor of main", () => {
    const main = fixture();
    const production = commit("src/app.ts", "a different deployed revision\n");
    const result = runWorkflow(production, main, "");
    expect(result.status).toBe(0);
    expect(result.calls).toMatch(/issue create/);
  });

  it("leaves the alert alone if the comparison is unknown or main moved", () => {
    fixture();
    const main = commit("docs/change.md", "documentation\n");
    expect(runWorkflow("0".repeat(40), main, "42")).toEqual({ status: 1, calls: "" });
  });

  it("does not close an alert after main advances during comparison", () => {
    const production = fixture();
    const main = commit("docs/change.md", "documentation\n");
    expect(runWorkflow(production, main, "42", "f".repeat(40))).toEqual({ status: 1, calls: "" });
  });
});
