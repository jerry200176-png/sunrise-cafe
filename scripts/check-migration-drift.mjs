#!/usr/bin/env node
/** Load .env file and print migration drift (no secrets) */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

const envFile = process.argv[2] ?? ".env.vercel.prod";
loadEnv(envFile);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = process.env.SUPABASE_DB_URL ?? "";

console.log(
  JSON.stringify(
    {
      env_file: envFile,
      project: url?.match(/https:\/\/([^.]+)/)?.[1],
      service_key_len: key?.length ?? 0,
      service_key_jwt: (key?.split(".").length ?? 0) === 3,
      db_url_configured: dbUrl.length > 0,
    },
    null,
    2
  )
);

if (!url || !key) {
  console.log("drift: unconfigured");
  process.exit(1);
}

const db = createClient(url, key);
const report = { applied: [], errors: [], closed_dates: false, rbac: false, overlap: false };

const { data: mig, error: migErr } = await db.from("schema_migrations").select("version").order("applied_at");
if (migErr) report.errors.push(migErr.message);
else {
  report.applied = mig?.map((m) => m.version) ?? [];
  report.overlap = report.applied.includes("20260710-reservations-no-overlap");
}

const { error: rbacErr } = await db.from("admin_users").select("id").limit(1);
if (!rbacErr) report.rbac = true;

const { error: closedErr } = await db.from("branches").select("closed_dates").limit(1);
if (!closedErr) report.closed_dates = true;

console.log("drift:", JSON.stringify(report, null, 2));
