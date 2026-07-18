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
  if (k.startsWith("<") || /placeholder|changeme|your-/i.test(k)) return false;
  if (/\s/.test(k) || k.length < 20) return false;
  // Legacy JWT service-role keys (eyJ...header.payload.sig)
  if (k.split(".").length === 3 && k.length > 80) return true;
  // Newer Supabase secret keys (sb_secret_...) or opaque tokens used by PostgREST
  if (/^sb_(secret|publishable)_/i.test(k)) return true;
  // Opaque non-JWT keys observed in production (PostgREST accepts; shape ≠ JWT)
  if (k.length >= 40) return true;
  return false;
}

export function anonKeyLooksReal(k) {
  return serviceKeyLooksReal(k);
}

/** Live capability check — prefer over shape-only when URL+key present. */
export async function serviceKeyCanReadLedger(url, key) {
  if (!url || !serviceKeyLooksReal(key)) return false;
  const res = await restProbe(
    url,
    key,
    "/rest/v1/schema_migrations?select=version&limit=1"
  );
  return res.status === 200;
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
