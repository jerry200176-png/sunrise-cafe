import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function run(status: number, body: string, token = "synthetic-key-".repeat(5)) {
  const temp = mkdtempSync(join(tmpdir(), "sunrise-ops-probe-"));
  try {
    const preload = join(temp, "fetch.mjs");
    const loader = join(temp, "deny-db.mjs");
    writeFileSync(preload, `globalThis.fetch = async (_url, opts) => {
      if (opts?.method && opts.method !== 'GET') throw new Error('unexpected method');
      return new Response(process.env.SYNTHETIC_BODY, { status: Number(process.env.SYNTHETIC_STATUS) });
    };`);
    writeFileSync(loader, `export async function resolve(specifier, context, next) {
      if (specifier === 'postgres') { process.stderr.write('UNEXPECTED_DB_IMPORT'); throw new Error('database denied'); }
      return next(specifier, context);
    }`);
    const result = spawnSync(process.execPath, ["--no-warnings", `--experimental-loader=${loader}`, `--import=${preload}`,
      "scripts/apply-migration-ops-events.mjs"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 10_000,
      env: { NODE_ENV: "test", PATH: process.env.PATH, NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid",
        SUPABASE_SERVICE_ROLE_KEY: token, SUPABASE_DB_URL: "postgres://synthetic.invalid/db",
        SYNTHETIC_STATUS: String(status), SYNTHETIC_BODY: body },
    });
    return { status: result.status, output: result.stdout + result.stderr };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

describe("ops_events deployed runner", () => {
  it("accepts valid read-only visibility without importing postgres", () => {
    const result = run(200, "[]");
    expect(result.status).toBe(0);
    expect(result.output).not.toContain("UNEXPECTED_DB_IMPORT");
  });
  it.each([[401, '{"code":"PGRST205"}'], [403, "{}"], [404, '{"code":"PGRST205"}'],
    [500, "{}"], [200, "invalid"], [200, "{}"]])("does not execute SQL for HTTP %s or invalid response", (status, body) => {
    const result = run(status, body);
    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain("UNEXPECTED_DB_IMPORT");
    expect(result.output).not.toContain("synthetic-key");
  });
  it("does not execute SQL with missing REST credentials even if a database URL exists", () => {
    const result = run(200, "[]", "");
    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain("UNEXPECTED_DB_IMPORT");
  });
});
