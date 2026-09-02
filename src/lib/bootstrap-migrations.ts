/**
 * Idempotent DDL on production cold start (Vercel has POSTGRES_URL from Supabase integration).
 * Fail-open — never blocks deploy.
 */
import { readFileSync } from "fs";
import { join } from "path";

const OPS_EVENTS_SQL = readFileSync(
  join(process.cwd(), "supabase/migration-ops-events.sql"),
  "utf8"
);
const MARKET_PARITY_SQL = readFileSync(
  join(process.cwd(), "supabase/migration-market-parity-rounds-3-7.sql"),
  "utf8"
);
const LINE_DELIVERIES_SQL = readFileSync(
  join(process.cwd(), "supabase/migration-line-reminder-deliveries.sql"),
  "utf8"
);
const LINE_GUEST_DELIVERIES_SQL = readFileSync(
  join(process.cwd(), "supabase/migration-line-guest-notification-deliveries.sql"),
  "utf8"
);

function pgConnectionString(): string | null {
  const url =
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    null;
  if (!url || url.includes("[ref]") || url.includes("[region]")) return null;
  return url;
}

async function restColumnExists(table: string, column: string): Promise<boolean | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.startsWith("<") || key.length < 40) return null;
  try {
    const res = await fetch(
      `${url.replace(/\/$/, "")}/rest/v1/${table}?select=${column}&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (res.status === 200) return true;
    const text = await res.text();
    if (/42703|does not exist|PGRST205/i.test(text)) return false;
    return null;
  } catch {
    return null;
  }
}

async function opsEventsReady(): Promise<boolean> {
  const exists = await restColumnExists("ops_events", "id");
  return exists === true;
}

async function lineDeliveriesReady(): Promise<boolean> {
  const exists = await restColumnExists("line_reminder_deliveries", "id");
  return exists === true;
}

async function lineGuestDeliveriesReady(): Promise<boolean> {
  const exists = await restColumnExists("line_guest_notification_deliveries", "id");
  return exists === true;
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
  if (!conn) {
    console.log("[bootstrap-migrations] skip: no Postgres URL");
    return;
  }

  try {
    const { default: postgres } = await import("postgres");
    const sql = postgres(conn, { max: 1, idle_timeout: 15 });
    try {
      if (!(await opsEventsReady())) {
        console.log("[bootstrap-migrations] applying migration-ops-events.sql");
        await sql.unsafe(OPS_EVENTS_SQL);
      } else {
        console.log("[bootstrap-migrations] ops_events already ready");
      }

      const guest = await restColumnExists("reservations", "guest_confirmed_at");
      if (guest === false) {
        console.log("[bootstrap-migrations] applying market-parity Round 3–7 columns");
        await sql.unsafe(MARKET_PARITY_SQL);
      }

      if (!(await lineDeliveriesReady())) {
        console.log("[bootstrap-migrations] applying line reminder delivery ledger");
        await sql.unsafe(LINE_DELIVERIES_SQL);
      } else {
        console.log("[bootstrap-migrations] line reminder delivery ledger already ready");
      }

      if (!(await lineGuestDeliveriesReady())) {
        console.log("[bootstrap-migrations] applying LINE guest notification delivery ledger");
        await sql.unsafe(LINE_GUEST_DELIVERIES_SQL);
      } else {
        console.log("[bootstrap-migrations] LINE guest notification delivery ledger already ready");
      }
    } finally {
      await sql.end({ timeout: 10 });
    }
  } catch (err) {
    console.warn("[bootstrap-migrations] fail-open:", (err as Error).message);
  }
}
