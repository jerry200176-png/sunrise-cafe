/**
 * Synthetic experiment ONLY. The DB runs in an isolated Docker container;
 * the fake provider is a local loopback HTTP server. No real credentials.
 */
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const execute = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT = "synthetic-account-a";
const BODY = "synthetic-payload";
const ids = Array.from({ length: 10 }, (_, n) => `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`);
const tokens = Array.from({ length: 10 }, (_, n) => `10000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`);
const die = (message) => { throw new Error(message); };
const check = (value, message) => { if (!value) die(message); };
const args = process.argv.slice(2);
const worker = args[0] === "worker";
const container = args[worker ? 1 : 0];
const dockerConfig = args[worker ? 2 : 1];
check(/^[0-9a-f]{12,64}$/.test(container ?? ""), "Invalid synthetic container ID");
check(/^\/tmp\/sunrise-line-workers\.[A-Za-z0-9]+\/config$/.test(dockerConfig ?? ""), "Invalid synthetic Docker config");
async function sql(statement) {
  const { stdout } = await execute("docker", ["--config", dockerConfig, "--host", "unix:///var/run/docker.sock", "exec", "-i", container,
    "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "fixture", "-c", statement],
  { env: { PATH: process.env.PATH }, timeout: 10_000, maxBuffer: 10_000 });
  return stdout.trim();
}
async function attempt(id, token) {
  check(UUID.test(id) && UUID.test(token), "Invalid synthetic claim");
  return sql(`SET ROLE synthetic_new; SELECT fixture.begin_send('${id}','${token}',1,'${ACCOUNT}','${BODY}')`);
}
async function finish(id, token) {
  return sql(`SET ROLE synthetic_new; SELECT fixture.confirm('${id}','${token}',1,'${ACCOUNT}')`);
}
function originFromPort(port) {
  check(/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535, "Invalid synthetic provider port");
  return `http://127.0.0.1:${port}`;
}
if (worker) {
  const [, , , mode, id, token, port, auth] = args;
  check(UUID.test(id ?? "") && UUID.test(token ?? "") && UUID.test(auth ?? ""), "Invalid synthetic worker input");
  const origin = originFromPort(port);
  if (mode === "old-bypass") {
    // Models old sender code still holding a fake provider token after DB revoke.
    await fetch(`${origin}/send?behavior=accept`, { method: "POST", headers: { authorization: `Bearer ${auth}` }, body: JSON.stringify({ id, account: ACCOUNT, payload: BODY }) });
    process.exit(0);
  }
  const identity = await (await fetch(`${origin}/identity?mode=${mode}`, { headers: { authorization: `Bearer ${auth}` }, signal: AbortSignal.timeout(5000) })).json();
  if (identity.account !== ACCOUNT) process.exit(12);
  const started = await attempt(id, token);
  if (started !== "t") process.exit(10);
  if (mode === "lost-begin-response") process.exit(75); // commit observed only by the test harness
  if (mode === "crash-after-begin") process.exit(70);
  try {
    const behavior = ["drop", "timeout", "server-error", "conflict", "malformed", "wrong-response-account"].includes(mode) ? mode : "accept";
    const response = await fetch(`${origin}/send?behavior=${behavior}`, {
      method: "POST", headers: { authorization: `Bearer ${auth}` }, body: JSON.stringify({ id, account: ACCOUNT, payload: BODY }), signal: AbortSignal.timeout(mode === "timeout" ? 1000 : 5000),
    });
    const payload = await response.json();
    if (!response.ok || payload.accepted !== true || payload.account !== ACCOUNT) process.exit(75);
  } catch { process.exit(75); } // unknown; never retry the fake provider
  check(await finish(id, token) === "t", "Synthetic acknowledgement update failed");
  process.exit(0);
}

const fakeAuth = randomUUID();
const received = [];
const server = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${fakeAuth}`) { response.writeHead(401); response.end(); return; }
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/identity") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ account: url.searchParams.get("mode") === "wrong-identity" ? "synthetic-account-b" : ACCOUNT })); return;
  }
  if (request.method !== "POST" || url.pathname !== "/send") { response.writeHead(404); response.end(); return; }
  let raw = "";
  request.on("data", (part) => { raw += part; });
  request.on("end", () => {
    let payload;
    try { payload = JSON.parse(raw); } catch { response.writeHead(400); response.end(); return; }
    if (!UUID.test(payload.id ?? "") || payload.account !== ACCOUNT || payload.payload !== BODY) { response.writeHead(400); response.end(); return; }
    // Intentionally no fake-provider deduplication: a second POST remains visible.
    received.push(payload.id);
    if (url.searchParams.get("behavior") === "drop") { request.socket.destroy(); return; }
    if (url.searchParams.get("behavior") === "timeout") {
      setTimeout(() => { if (!response.destroyed) { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ accepted: true, account: ACCOUNT })); } }, 2000).unref();
      return;
    }
    if (url.searchParams.get("behavior") === "server-error") { response.writeHead(500, { "content-type": "application/json" }); response.end('{}'); return; }
    if (url.searchParams.get("behavior") === "conflict") { response.writeHead(409, { "content-type": "application/json" }); response.end('{"accepted":true}'); return; }
    if (url.searchParams.get("behavior") === "malformed") { response.writeHead(200, { "content-type": "application/json" }); response.end('{'); return; }
    if (url.searchParams.get("behavior") === "wrong-response-account") { response.writeHead(200, { "content-type": "application/json" }); response.end('{"accepted":true,"account":"synthetic-account-b"}'); return; }
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ accepted: true, account: ACCOUNT }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = String(server.address().port);
function start(mode, index) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.argv[1], "worker", container, dockerConfig, mode, ids[index], tokens[index], port, fakeAuth],
      { env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr.on("data", (part) => { stderr += part; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Synthetic worker timed out")); }, 15_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); if (stderr) reject(new Error(`Synthetic worker error: ${stderr.slice(0, 500)}`)); else resolve(code); });
  });
}
try {
  const state = (id) => sql(`SELECT state FROM fixture.delivery WHERE id='${id}'`);
  // DB fencing blocks newly initiated legacy DB calls, but does not revoke an
  // already-running sender's separate provider credential or network access.
  let oldDenied = false;
  try { await sql(`SET ROLE synthetic_old; SELECT fixture.legacy_claim('${ids[0]}')`); } catch { oldDenied = true; }
  check(oldDenied, "Old role was not fenced");
  check(await start("old-bypass", 4) === 0, "Synthetic old provider call failed");
  check(received.filter((id) => id === ids[4]).length === 1, "Old sender did not outlive DB revoke in fake model");
  // Two separate processes race one token. Fake provider accepts then drops the
  // response; one process sees unknown, the other never makes an HTTP send.
  const results = await Promise.all([start("drop", 0), start("drop", 0)]);
  check(results.includes(75) && results.includes(10), `Unexpected concurrent worker result ${results}`);
  check(received.filter((id) => id === ids[0]).length === 1 && await state(ids[0]) === "attempted", "Unknown outcome not quarantined");
  check(await start("drop", 0) === 10 && received.filter((id) => id === ids[0]).length === 1, "Rollback-like retry sent twice");
  // A confirmed fake provider response can be acknowledged idempotently.
  check(await start("success", 1) === 0 && await state(ids[1]) === "accepted", "Synthetic successful send was not acknowledged");
  check(await finish(ids[1], tokens[1]) === "t" && received.filter((id) => id === ids[1]).length === 1, "Synthetic acknowledgement retry changed provider calls");
  // Crash and lost begin acknowledgement happen before any provider request.
  check(await start("crash-after-begin", 2) === 70 && await start("success", 2) === 10, "Crash was retried");
  check(await start("lost-begin-response", 3) === 75 && await start("success", 3) === 10, "Lost begin acknowledgement was retried");
  check(received.filter((id) => ids.slice(2, 4).includes(id)).length === 0, "Unknown begin caused provider request");
  // Wrong fake account is refused before any DB attempt or fake send.
  check(await start("wrong-identity", 4) === 12 && await state(ids[4]) === "claimed", "Wrong fake account was not rejected");
  check(received.filter((id) => id === ids[4]).length === 1, "Wrong fake identity sent a provider request");
  // The fake provider accepts and either delays past the deadline or emits a
  // 500. Both outcomes remain unknown; a later worker cannot send again.
  for (const [mode, index] of [["timeout", 5], ["server-error", 6], ["conflict", 7], ["malformed", 8], ["wrong-response-account", 9]]) {
    check(await start(mode, index) === 75 && await start("success", index) === 10, `Synthetic ${mode} was retried`);
    check(received.filter((id) => id === ids[index]).length === 1 && await state(ids[index]) === "attempted", `Synthetic ${mode} not quarantined`);
  }
  await delay(50);
  console.log(JSON.stringify({ separate_worker_race: results, fake_accepts_after_lost_response: 1,
    retry_after_unknown_blocked: true, fake_timeout_500_409_malformed_wrong_account_blocked: true,
    old_sender_after_db_revoke: true, wrong_fake_identity_blocked: true }));
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
