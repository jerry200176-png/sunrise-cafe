/** A REST cache error cannot authorize replaying a migration. Never log its body. */
export async function assertRestSchemaProbe(url, headers, label, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error(`${label} schema probe unknown: network error or timeout`);
  }
  if (response.status === 200) {
    try {
      const rows = await response.json();
      const columns = new URL(url).searchParams.get("select")?.split(",") ?? [];
      if (columns.length && Array.isArray(rows) && rows.every((row) =>
        row !== null && typeof row === "object" && !Array.isArray(row) &&
        columns.every((column) => Object.hasOwn(row, column)))) return;
    } catch { /* An invalid or truncated body is not proof of readiness. */ }
    throw new Error(`${label} schema probe unknown: invalid success response`);
  }

  let code;
  try { code = (await response.json())?.code; } catch { /* Unknown response. */ }
  const missingCode = (response.status === 400 && code === "42703") ||
    (response.status === 404 && (code === "42P01" || code === "PGRST205")) ||
    (response.status === 400 && code === "PGRST204");
  if (missingCode) {
    throw new Error(`${label} schema probe reports a missing or stale schema (${code}); catalog verification and a reviewed migration are required`);
  }
  throw new Error(`${label} schema probe unknown (HTTP ${response.status}); no migration was run`);
}
