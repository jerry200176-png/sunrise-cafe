/**
 * Idempotent DDL on production cold start (Vercel has POSTGRES_URL from Supabase integration).
 * Fail-open — never blocks deploy.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";

const OPS_EVENTS_SQL = readFileSync(
  join(process.cwd(), "supabase/migration-ops-events.sql"),
  "utf8"
);

function pgConnectionString(): string | null {
  return (
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    null
  );
}

async function opsEventsReady(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.startsWith("<")) return false;
  const { error } = await createClient(url, key).from("ops_events").select("id").limit(1);
  return !error;
}

let bootstrapPromise: Promise<void> | null = null;

export function runBootstrapMigrations(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = bootstrapMigrations();
  return bootstrapPromise;
}

async function bootstrapMigrations(): Promise<void> {
  if (process.env.VERCEL_ENV !== "production") return;

  const conn = pgConnectionString();
  if (!conn || conn.includes("[ref]")) {
    console.log("[bootstrap-migrations] skip: no Postgres URL");
    return;
  }

  try {
    if (await opsEventsReady()) {
      console.log("[bootstrap-migrations] ops_events already ready");
      return;
    }

    const { default: postgres } = await import("postgres");
    const sql = postgres(conn, { max: 1, idle_timeout: 15 });
    try {
      console.log("[bootstrap-migrations] applying migration-ops-events.sql");
      await sql.unsafe(OPS_EVENTS_SQL);
    } finally {
      await sql.end({ timeout: 10 });
    }

    if (await opsEventsReady()) {
      console.log("[bootstrap-migrations] ops_events applied");
    } else {
      console.warn("[bootstrap-migrations] migration ran but ops_events probe still failing");
    }
  } catch (err) {
    console.warn("[bootstrap-migrations] fail-open:", (err as Error).message);
  }
}
