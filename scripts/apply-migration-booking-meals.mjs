#!/usr/bin/env node
/** Apply and verify only the approved booking-meals migration before deployment. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./apply-migration-reservation-preorder.mjs";

const VERSION = "20260924-booking-meals";
const PREREQUISITE = "20260921-reservation-preorder";
const MIGRATION_FILE = "migration-booking-meals.sql";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(join(scriptDir, "../supabase", MIGRATION_FILE), "utf8");

// The checked-in SQL remains safe for manual SQL Editor use. The runner owns
// the transaction and strips only the exact outer transaction wrapper.
export function migrationBody(source) {
  const match = /^(?:--[^\n]*\n)*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/.exec(source);
  if (!match) throw new Error("Booking meals SQL transaction wrapper changed");
  return match[1];
}

async function hasVersion(sql, version) {
  const rows = await sql`SELECT 1 FROM schema_migrations WHERE version = ${version} LIMIT 1`;
  return rows.length === 1;
}

export async function verifyBookingMeals(sql) {
  if (!(await hasVersion(sql, VERSION))) throw new Error(`${VERSION} missing from schema_migrations`);

  const expectedColumns = {
    reservations: ["booking_request_key"],
    orders: ["reservation_id", "paid_at"],
    order_items: ["served_at", "source_preorder_item_id"],
  };
  const columns = await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY(${sql.array(Object.keys(expectedColumns))})
  `;
  const present = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = Object.entries(expectedColumns).flatMap(([table, names]) =>
    names.filter((name) => !present.has(`${table}.${name}`)).map((name) => `${table}.${name}`)
  );
  if (missing.length) throw new Error(`Booking meals columns missing: ${missing.join(", ")}`);

  const functions = await sql`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(${sql.array([
        "create_booking_with_meals", "activate_reservation_order",
        "staff_replace_preorder", "replace_menu_item_options",
        "recalculate_reservation_order_total", "guard_reservation_order_item_change",
      ])})
  `;
  const functionNames = new Set(functions.map((row) => row.proname));
  for (const name of ["create_booking_with_meals", "activate_reservation_order", "staff_replace_preorder",
    "replace_menu_item_options", "recalculate_reservation_order_total", "guard_reservation_order_item_change"]) {
    if (!functionNames.has(name)) throw new Error(`Booking meals function missing: ${name}`);
  }

  const triggers = await sql`
    SELECT tgname FROM pg_trigger AS tr
    JOIN pg_class AS t ON t.oid = tr.tgrelid
    JOIN pg_namespace AS n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'order_items'
      AND tr.tgname = ANY(${sql.array([
        "trg_guard_reservation_order_item_change", "trg_recalculate_reservation_order_total",
      ])}) AND NOT tr.tgisinternal
  `;
  if (new Set(triggers.map((row) => row.tgname)).size !== 2) {
    throw new Error("Booking meals item guard or total trigger missing");
  }

  const policies = await sql`
    SELECT tablename, policyname, qual, with_check FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = ANY(${sql.array([
        "anon_read_orders", "anon_read_order_items", "anon_insert_orders", "anon_insert_order_items",
      ])})
  `;
  const policyMap = new Map(policies.map((row) => [`${row.tablename}.${row.policyname}`, row]));
  for (const [table, name] of [["orders", "anon_read_orders"], ["order_items", "anon_read_order_items"],
    ["orders", "anon_insert_orders"], ["order_items", "anon_insert_order_items"]]) {
    const policy = policyMap.get(`${table}.${name}`);
    if (!policy || !`${policy.qual ?? ""} ${policy.with_check ?? ""}`.includes("reservation_id IS NULL")) {
      throw new Error(`Booking meals private-order policy missing: ${table}.${name}`);
    }
  }

  const grants = await sql`
    SELECT
      has_function_privilege('anon', 'public.create_booking_with_meals(jsonb,jsonb,text,text)', 'EXECUTE') AS guest_create,
      has_function_privilege('authenticated', 'public.activate_reservation_order(uuid)', 'EXECUTE') AS user_activate,
      has_function_privilege('service_role', 'public.create_booking_with_meals(jsonb,jsonb,text,text)', 'EXECUTE') AS service_create,
      has_function_privilege('service_role', 'public.activate_reservation_order(uuid)', 'EXECUTE') AS service_activate
  `;
  const grant = grants[0];
  if (grant.guest_create || grant.user_activate || !grant.service_create || !grant.service_activate) {
    throw new Error("Booking meals RPC privilege boundary is invalid");
  }
  return { ledger: VERSION, columns: present.size, functions: functionNames.size, triggers: 2, policies: 4 };
}

export async function applyBookingMeals(sql, source = SQL) {
  if (!(await hasVersion(sql, PREREQUISITE))) {
    throw new Error(`Prerequisite migration missing: ${PREREQUISITE}`);
  }
  if (await hasVersion(sql, VERSION)) {
    console.log(JSON.stringify({ migration: VERSION, status: "already_applied" }));
  } else {
    const body = migrationBody(source);
    await sql.begin(async (transaction) => transaction.unsafe(body));
    console.log(JSON.stringify({ migration: VERSION, status: "applied" }));
  }
  return verifyBookingMeals(sql);
}

async function main() {
  const sql = await connect();
  try {
    console.log(JSON.stringify({ migration: VERSION, verification: await applyBookingMeals(sql) }));
  } finally {
    await sql.end({ timeout: 10 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
