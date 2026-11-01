import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import { assertRestSchemaProbe, requireSecureSupabaseBase } from "./lib/rest-schema-probe.mjs";

const runners = ["line-pay-safety", "market-parity"];
const ready = { status: 200, body: "[]" };
const scenarios = [
  ["HTTP 302", { status: 302, body: '{}' }, /unknown/],
  ["HTTP 307", { status: 307, body: '{}' }, /unknown/],
  ["oversized response", { status: 200, body: "x".repeat(70000) }, /unknown/],
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
      NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co",
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
  test(`${runner}: nonempty success rows are rejected when limit=0`, () => {
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
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /invalid success response/);
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


test("base URL fails closed for insecure, decorated, non-hosted or disabled-TLS targets", () => {
  assert.equal(requireSecureSupabaseBase("https://synthetic.supabase.co/"), "https://synthetic.supabase.co");
  for (const value of ["", "http://synthetic.supabase.co", "https://other.invalid", "https://synthetic.supabase.co.evil.invalid", "https://user:pass@synthetic.supabase.co", "https://synthetic.supabase.co/path", "https://synthetic.supabase.co?x=1", "https://synthetic.supabase.co#x", "https://synthetic.supabase.co:444"]) {
    assert.throws(() => requireSecureSupabaseBase(value));
  }
  const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    assert.throws(() => requireSecureSupabaseBase("https://synthetic.supabase.co"), /TLS certificate verification/);
  } finally {
    if (before === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = before;
  }
});

test("a cross-origin redirect never receives the synthetic apikey or passes readiness", async () => {
  let destinationRequests = 0;
  let sourceSawKey = false;
  const destination = http.createServer((_request, response) => {
    destinationRequests += 1;
    response.writeHead(200, { "content-type": "application/json" }); response.end("[]");
  });
  destination.listen(0, "127.0.0.1"); await once(destination, "listening");
  const source = http.createServer((request, response) => {
    sourceSawKey = Boolean(request.headers.apikey);
    response.writeHead(302, { location: `http://127.0.0.1:${destination.address().port}/target` }); response.end();
  });
  source.listen(0, "127.0.0.1"); await once(source, "listening");
  try {
    // Rewrite only inside the test to an isolated loopback server; retain all
    // options and headers so native fetch's redirect behavior is exercised.
    const loopbackFetch = (_url, options) => fetch(`http://127.0.0.1:${source.address().port}/probe`, options);
    await assert.rejects(assertRestSchemaProbe("https://synthetic.supabase.co/rest/v1/reservations?select=id&limit=0", { apikey: "synthetic-key" }, "synthetic", loopbackFetch), /unknown/);
    assert.equal(sourceSawKey, true);
    assert.equal(destinationRequests, 0);
  } finally { source.close(); destination.close(); }
});

test("TLS rejects an untrusted synthetic certificate before sending the apikey", async () => {
  const temp = mkdtempSync(join(tmpdir(), "sunrise-probe-tls-"));
  const key = join(temp, "key.pem"); const cert = join(temp, "cert.pem");
  const created = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore", timeout: 10000 });
  assert.equal(created.status, 0, "synthetic TLS certificate generation failed");
  let requests = 0;
  const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_req, response) => { requests += 1; response.end("[]"); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const loopbackFetch = (_url, options) => fetch(`https://127.0.0.1:${server.address().port}/probe`, options);
    await assert.rejects(assertRestSchemaProbe("https://synthetic.supabase.co/rest/v1/reservations?select=id&limit=0", { apikey: "synthetic-key" }, "synthetic", loopbackFetch), /unknown/);
    assert.equal(requests, 0);
  } finally { server.close(); rmSync(temp, { recursive: true, force: true }); }
});

test("invalid paths, parameters and userinfo are rejected before a fetch", async () => {
  let calls = 0;
  const unexpectedFetch = () => { calls += 1; throw new Error("unexpected fetch"); };
  for (const target of [
    "https://user:pass@synthetic.supabase.co/rest/v1/reservations?select=id&limit=0",
    "https://synthetic.supabase.co/rest/v1/rpc/side_effect?select=id&limit=0",
    "https://synthetic.supabase.co/rest/v1/reservations?select=id&limit=1",
    "https://synthetic.supabase.co/rest/v1/reservations?select=id&limit=0&other=x",
    "https://synthetic.supabase.co/rest/v1/reservations?select=id&limit=0&limit=0",
    "https://synthetic.supabase.co/rest/v1/reservations?select=id&limit=0#fragment",
  ]) await assert.rejects(assertRestSchemaProbe(target, { apikey: "synthetic-key" }, "synthetic", unexpectedFetch));
  assert.equal(calls, 0);
});

test("a stalled response body is bounded by the fetch abort signal", async () => {
  let started = false;
  const source = http.createServer((_request, response) => {
    started = true;
    response.writeHead(200, { "content-type": "application/json" });
    response.write("[");
  });
  source.listen(0, "127.0.0.1"); await once(source, "listening");
  const previousTimeout = AbortSignal.timeout;
  try {
    // Exercise native abort semantics without making the synthetic test wait 10s.
    AbortSignal.timeout = () => previousTimeout(80);
    const loopbackFetch = (_url, options) => fetch(`http://127.0.0.1:${source.address().port}/probe`, options);
    await assert.rejects(assertRestSchemaProbe("https://synthetic.supabase.co/rest/v1/reservations?select=id&limit=0", { apikey: "synthetic-key" }, "synthetic", loopbackFetch), /unknown/);
    assert.equal(started, true);
  } finally {
    AbortSignal.timeout = previousTimeout;
    source.closeAllConnections(); source.close();
  }
});
