/** Read-only REST visibility probe. A missing or uncertain result never authorizes DDL. */
export async function probeOpsEvents({ url, allowedOrigin, key, fetchImpl = fetch }) {
  if (typeof url !== "string" || url.trim() !== url || typeof allowedOrigin !== "string" ||
      allowedOrigin.trim() !== allowedOrigin || typeof key !== "string" || key.startsWith("<") || key.length < 40) return false;
  try {
    const base = new URL(url);
    const allowed = new URL(allowedOrigin);
    // The configured target is trusted separately; reject accidental HTTP,
    // userinfo and path/query overrides before attaching service credentials.
    if ([base, allowed].some((candidate) => candidate.protocol !== "https:" || candidate.username || candidate.password ||
        candidate.pathname !== "/" || candidate.search || candidate.hash) || base.origin !== allowed.origin) return false;
    const endpoint = new URL("/rest/v1/ops_events?select=id&limit=0", base).toString();
    const response = await fetchImpl(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) return false;
    const rows = await response.json();
    return Array.isArray(rows) && rows.length === 0;
  } catch {
    return false;
  }
}
