/**
 * Idempotent DDL on production cold start (Vercel has POSTGRES_URL from Supabase integration).
 * Fail-open — never blocks deploy.
 */
import { readFileSync } from "fs";
import { join } from "path";

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

async function lineDeliveriesReady(): Promise<boolean> {
  const exists = await restColumnExists("line_reminder_deliveries", "id");
  if (exists !== true) return false;
  return (await claimLineReminderRpcReady()) === true;
}

/** PostgREST must expose the claim RPC; a table without the function still fails cron. */
async function claimLineReminderRpcReady(): Promise<boolean | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.startsWith("<") || key.length < 40) return null;
  try {
    const res = await fetch(
      `${url.replace(/\/$/, "")}/rest/v1/rpc/claim_line_reminder_delivery`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          p_reminder_type: "d1_group",
          p_reminder_date: "2099-01-01",
          p_reservation_id: "00000000-0000-4000-8000-000000000000",
          p_recipient_type: "group",
          p_recipient_id: "ledger-probe",
        }),
      }
    );
    const text = await res.text();
    if (/PGRST202|Could not find the function/i.test(text)) return false;
    if (res.ok || (res.status >= 400 && res.status < 500)) return true;
    return null;
  } catch {
    return null;
  }
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
      const guest = await restColumnExists("reservations", "guest_confirmed_at");
      if (guest === false) {
        console.log("[bootstrap-migrations] applying market-parity Round 3–7 columns");
        await sql.unsafe(MARKET_PARITY_SQL);
      }

      if (!(await lineDeliveriesReady())) {
        console.log("[bootstrap-migrations] applying line reminder delivery ledger");
        await sql.unsafe(LINE_DELIVERIES_SQL);
        await sql.unsafe("NOTIFY pgrst, 'reload schema'");
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
