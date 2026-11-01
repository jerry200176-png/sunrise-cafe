import { describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import { probeOpsEvents } from "./ops-events-readiness.mjs";

const config = { url: "https://synthetic.invalid", allowedOrigin: "https://synthetic.invalid", key: "synthetic-key-".repeat(5) };

describe("ops_events read-only REST readiness", () => {
  it.each([[[]]])("accepts an empty limit=0 REST response %j", async (body) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }));
    expect(await probeOpsEvents({ ...config, fetchImpl })).toBe(true);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://synthetic.invalid/rest/v1/ops_events?select=id&limit=0");
    expect(options?.method).toBeUndefined();
    expect(options?.redirect).toBe("manual");
  });

  it.each([
    [401, '{"code":"PGRST205","message":"does not exist"}'],
    [403, '{"message":"permission denied"}'], [404, '{"code":"PGRST205"}'],
    [500, '{"code":"42P01"}'], [200, 'not-json'], [200, '{}'], [200, '[{}]'], [200, '[{"id":"synthetic"}]'],
  ])("fails closed for HTTP %s or invalid data", async (status, body) => {
    const fetchImpl = vi.fn(async () => new Response(body, { status }));
    expect(await probeOpsEvents({ ...config, fetchImpl })).toBe(false);
  });

  it("fails closed without usable config or after a timeout", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("synthetic private detail"); });
    expect(await probeOpsEvents({ url: "", allowedOrigin: "", key: "", fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await probeOpsEvents({ ...config, fetchImpl })).toBe(false);
  });

  it.each(["http://synthetic.invalid", "https://user:pass@synthetic.invalid", "https://synthetic.invalid/base",
    "https://synthetic.invalid/?query=1", "https://synthetic.invalid/#fragment", " https://synthetic.invalid"])
  ("rejects an unsafe or ambiguous base URL before attaching credentials: %s", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await probeOpsEvents({ url, allowedOrigin: config.allowedOrigin, key: config.key, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not send credentials without an independently configured matching origin", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const allowedOrigin of ["", "https://other.invalid", "http://synthetic.invalid", "https://synthetic.invalid/path"]) {
      expect(await probeOpsEvents({ ...config, allowedOrigin, fetchImpl })).toBe(false);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks credentials when TLS verification is disabled and accepts a trusted TLS connection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ops-readiness-tls-"));
    const keyPath = join(dir, "server.key");
    const certPath = join(dir, "server.crt");
    let received = 0;
    let server: ReturnType<typeof createHttpsServer> | undefined;
    try {
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
        "-keyout", keyPath, "-out", certPath], { stdio: "ignore" });
      server = createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (request, response) => {
        if (request.headers.apikey === config.key) received++;
        response.writeHead(200, { "content-type": "application/json" }); response.end("[]");
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const moduleUrl = pathToFileURL(join(process.cwd(), "src/lib/ops-events-readiness.mjs")).href;
      const script = `import { probeOpsEvents } from ${JSON.stringify(moduleUrl)};\n` +
        `console.log(JSON.stringify(await probeOpsEvents(${JSON.stringify({ url: origin, allowedOrigin: origin, key: config.key })})));`;
      const env = { ...process.env };
      delete env.NODE_TLS_REJECT_UNAUTHORIZED;
      delete env.NODE_EXTRA_CA_CERTS;
      const run = promisify(execFile);
      const disabled = await run(process.execPath, ["--input-type=module", "-e", script], {
        env: { ...env, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      });
      expect(disabled.stdout.trim()).toBe("false");
      expect(received).toBe(0);
      const untrusted = await run(process.execPath, ["--input-type=module", "-e", script], { env });
      expect(untrusted.stdout.trim()).toBe("false");
      expect(received).toBe(0);
      const trusted = await run(process.execPath, ["--input-type=module", "-e", script], {
        env: { ...env, NODE_EXTRA_CA_CERTS: certPath },
      });
      expect(trusted.stdout.trim()).toBe("true");
      expect(received).toBe(1);
    } finally {
      if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it.each(["cross-origin", "same-origin"])("does not follow a %s redirect or forward the synthetic key", async (kind) => {
    let otherCalls = 0;
    const other = createServer((_request, response) => {
      otherCalls++; response.writeHead(200, { "content-type": "application/json" }); response.end("[]");
    });
    const listen = async (server: Server) => {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return (server.address() as AddressInfo).port;
    };
    const close = (server: Server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const otherPort = await listen(other);
    let redirectedCalls = 0;
    const first = createServer((request, response) => {
      if (request.url === "/redirect-target") { redirectedCalls++; response.writeHead(200); response.end("[]"); return; }
      response.writeHead(302, { location: kind === "cross-origin" ? `http://127.0.0.1:${otherPort}/capture` : "/redirect-target" });
      response.end();
    });
    try {
      const firstPort = await listen(first);
      // Only the synthetic test transport maps the validated HTTPS origin to loopback HTTP.
      const loopbackFetch: typeof fetch = (_url, options) => fetch(`http://127.0.0.1:${firstPort}/probe`, options);
      expect(await probeOpsEvents({ ...config, fetchImpl: loopbackFetch })).toBe(false);
      expect(otherCalls).toBe(0);
      expect(redirectedCalls).toBe(0);
    } finally { await close(first); await close(other); }
  });
});
