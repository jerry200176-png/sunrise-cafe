/** A failed REST probe never authorizes replaying a migration. Do not log bodies or credentials. */
const HOSTED_PROJECT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.supabase\.co$/;
const MAX_BODY_BYTES = 64 * 1024;

/** Accept only an unadorned hosted Supabase HTTPS origin, with normal TLS verification. */
export function requireSecureSupabaseBase(raw) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("REST schema probe requires TLS certificate verification");
  let base;
  try { base = new URL(raw); } catch { throw new Error("REST schema probe requires a valid hosted Supabase HTTPS origin"); }
  if (base.protocol !== "https:" || !HOSTED_PROJECT.test(base.hostname) || base.username || base.password ||
      base.port || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("REST schema probe requires a valid hosted Supabase HTTPS origin");
  }
  return base.origin;
}

function checkedProbeUrl(raw) {
  let target;
  try { target = new URL(raw); } catch { throw new Error("REST schema probe has an invalid target"); }
  // Check the complete URL before extracting its origin so userinfo cannot disappear.
  if (target.username || target.password || target.hash) throw new Error("REST schema probe has an invalid target");
  requireSecureSupabaseBase(target.origin);
  if (!/^\/rest\/v1\/[a-z_][a-z0-9_]*$/.test(target.pathname) || target.pathname.startsWith("/rest/v1/rpc/") ||
      [...target.searchParams.keys()].some((key) => key !== "select" && key !== "limit") ||
      target.searchParams.getAll("select").length !== 1 || target.searchParams.getAll("limit").length !== 1 ||
      !/^[a-z_][a-z0-9_]*(?:,[a-z_][a-z0-9_]*)*$/.test(target.searchParams.get("select") ?? "") ||
      target.searchParams.get("limit") !== "0") {
    throw new Error("REST schema probe has an invalid target");
  }
  return target;
}

async function boundedJson(response) {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new Error("response too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty response");
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error("response too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    if (size > MAX_BODY_BYTES) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** A 200/[] response only proves the selected REST fields were accepted. */
export async function assertRestSchemaProbe(url, headers, label, fetchImpl = fetch) {
  const target = checkedProbeUrl(url);
  let response;
  try {
    // Fetch otherwise follows redirects and forwards the custom apikey header
    // to a different origin, even though Authorization is stripped.
    response = await fetchImpl(target.href, { headers, method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error(`${label} schema probe unknown: network error, redirect or timeout`);
  }
  if (response.status === 200) {
    try {
      const rows = await boundedJson(response);
      if (Array.isArray(rows) && rows.length === 0) return;
    } catch { /* Invalid or incomplete body is not readiness evidence. */ }
    throw new Error(`${label} schema probe unknown: invalid success response`);
  }

  let code;
  try { code = (await boundedJson(response))?.code; } catch { /* Unknown response. */ }
  const missingCode = (response.status === 400 && code === "42703") ||
    (response.status === 404 && (code === "42P01" || code === "PGRST205")) ||
    (response.status === 400 && code === "PGRST204");
  if (missingCode) {
    throw new Error(`${label} schema probe reports a missing or stale schema (${code}); catalog verification and a reviewed migration are required`);
  }
  throw new Error(`${label} schema probe unknown (HTTP ${response.status}); no migration was run`);
}
