/** Read-only REST visibility probe. A missing or uncertain result never authorizes DDL. */
export async function probeOpsEvents({ url, key, fetchImpl = fetch }) {
  if (!url || !key || key.startsWith("<") || key.length < 40) return false;
  try {
    const response = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/ops_events?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) return false;
    const rows = await response.json();
    return Array.isArray(rows) && rows.every((row) => row !== null && typeof row === "object" &&
      !Array.isArray(row) && typeof row.id === "string");
  } catch {
    return false;
  }
}
