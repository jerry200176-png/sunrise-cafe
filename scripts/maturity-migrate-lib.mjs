/**
 * Shared helpers for controlled maturity migrations.
 * Never print secret values — only presence/shape metadata.
 */
export function redactUrl(u) {
  if (!u) return null;
  try {
    const parsed = new URL(u.includes("://") ? u : `postgresql://${u}`);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || ""}/[redacted]`;
  } catch {
    return "[unparseable]";
  }
}

export function dbUrlLooksReal(u) {
  if (!u || typeof u !== "string") return false;
  if (/\[ref\]|\[region\]|placeholder|changeme|your-/i.test(u)) return false;
  if (u.length < 30) return false;
  return /postgres(ql)?:\/\//i.test(u);
}

export function serviceKeyLooksReal(k) {
  if (!k || typeof k !== "string") return false;
  if (k.startsWith("<") || k.includes("placeholder")) return false;
  // JWT-shaped service role keys have 3 segments
  return k.split(".").length === 3 && k.length > 80;
}

export function anonKeyLooksReal(k) {
  return serviceKeyLooksReal(k);
}

export function logEnvPresence() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const db =
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    "";
  console.log(
    JSON.stringify({
      supabase_url_host: (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return null;
        }
      })(),
      service_key_ok: serviceKeyLooksReal(service),
      service_key_len: service.length,
      anon_key_ok: anonKeyLooksReal(anon),
      db_url_ok: dbUrlLooksReal(db),
      db_url_redacted: redactUrl(db),
    })
  );
  return { url, service, anon, db };
}

export function resolveDbUrl() {
  return (
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    ""
  );
}

export async function restProbe(url, key, path) {
  const res = await fetch(`${url.replace(/\/$/, "")}${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 240) };
}
