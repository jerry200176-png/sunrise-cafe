import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const runners = ["line-pay-safety", "market-parity"];
const ready = { status: 200, body: "[]" };
const scenarios = [
  ["HTTP 401", { status: 401, body: '{"code":"42501"}' }, /unknown/],
  ["HTTP 403 with misleading missing text", { status: 403, body: '{"code":"42501","message":"does not exist"}' }, /unknown/],
  ["HTTP 429", { status: 429, body: '{}' }, /unknown/],
  ["HTTP 500 with misleading missing code", { status: 500, body: '{"code":"42703"}' }, /unknown/],
  ["unrelated HTTP 404", { status: 404, body: '{}' }, /unknown/],
  ["malformed error", { status: 400, body: 'bad response' }, /unknown/],
  ["malformed success", { status: 200, body: 'bad response' }, /unknown/],
  ["non-array success", { status: 200, body: '{}' }, /unknown/],
  ["success with null row", { status: 200, body: '[null]' }, /unknown/],
  ["success with malformed row", { status: 200, body: '[1]' }, /unknown/],
  ["success with missing fields", { status: 200, body: '[{}]' }, /unknown/],
  ["stale/missing table", { status: 404, body: '{"code":"PGRST205"}' }, /missing or stale/],
  ["stale/missing column", { status: 400, body: '{"code":"PGRST204"}' }, /missing or stale/],
  ["undefined column", { status: 400, body: '{"code":"42703"}' }, /missing or stale/],
  ["transport failure", { throw: true }, /unknown/],
];

function run(runner, scenario, credentials = true) {
  return spawnSync(process.execPath, ["--no-warnings", "--experimental-loader", resolve("scripts/test-fixtures/deny-db-loader.mjs"), "--import", resolve("scripts/test-fixtures/mock-rest-preload.mjs"), resolve(`scripts/verify-${runner}.mjs`)], {
    env: {
      SYNTHETIC_SCENARIO: JSON.stringify(scenario),
      NEXT_PUBLIC_SUPABASE_URL: "http://invalid.example",
      ...(credentials ? { SUPABASE_SERVICE_ROLE_KEY: "synthetic-key-".repeat(5) } : {}),
      // If a runner unexpectedly attempts Postgres, do not provide a usable URL.
      SUPABASE_DB_URL: "[ref]",
    },
    encoding: "utf8", timeout: 5000,
  });
}

test("database guard reports imports even if the caller catches the error", () => {
  const result = spawnSync(process.execPath, ["--no-warnings", "--experimental-loader", resolve("scripts/test-fixtures/deny-db-loader.mjs"), "--input-type=module", "-e", 'import("postgres").catch(() => {})'], { encoding: "utf8", timeout: 5000, env: {} });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /UNEXPECTED_DB_IMPORT/);
});

for (const runner of runners) {
  test(`${runner}: successful probes`, () => {
    const result = run(runner, { default: ready });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_DB_IMPORT/);
  });
  test(`${runner}: nonempty rows contain selected fields`, () => {
    const responses = runner === "line-pay-safety" ? [
      { match: "line_pay_payments", status: 200, body: '[{"id":1,"confirm_attempt_id":null}]' },
      { match: "line_pay_notification_outbox", status: 200, body: '[{"id":1,"status":"pending"}]' },
    ] : [
      { match: "guest_confirmed_at", status: 200, body: '[{"guest_confirmed_at":null}]' },
      { match: "deposit_urgent_reminder_sent_at", status: 200, body: '[{"deposit_urgent_reminder_sent_at":null}]' },
      { match: "staff_called_at", status: 200, body: '[{"staff_called_at":null}]' },
      { match: "staff_alerted_at", status: 200, body: '[{"staff_alerted_at":null}]' },
    ];
    const result = run(runner, { default: ready, responses });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_DB_IMPORT/);
  });
  test(`${runner}: missing credentials fail`, () => {
    const result = run(runner, { default: ready }, false);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown/);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_DB_IMPORT/);
  });
  for (const [name, response, expected] of scenarios) {
    test(`${runner}: ${name} stops without DDL`, () => {
      const result = run(runner, { default: response });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, expected);
      assert.doesNotMatch(result.stdout + result.stderr, /Applying|UNEXPECTED_DB_IMPORT|synthetic-key/);
    });
  }
  test(`${runner}: one failing probe stops even when others are ready`, () => {
    const match = runner === "market-parity" ? "staff_alerted_at" : "line_pay_notification_outbox";
    const result = run(runner, { default: ready, responses: [{ match, status: 503, body: '{}' }] });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /unknown/);
    assert.doesNotMatch(result.stdout + result.stderr, /Applying|UNEXPECTED_DB_IMPORT|synthetic-key/);
  });
}
