#!/usr/bin/env node
/** Standalone preflight only. Not wired into deployment or migration application. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "./apply-migration-bank-transfer-reports.mjs";

export async function verifyBankTransferReports(sql) {
  // Never pass the application client to the verifier. The server enforces the
  // read-only boundary; this entrypoint never invokes apply or ACL repair.
  return sql.begin("read only", (transaction) => verify(transaction));
}

async function main() {
  const { connect } = await import("./apply-migration-reservation-preorder.mjs");
  const sql = await connect();
  try {
    console.log(JSON.stringify({ mode: "read-only", verification: await verifyBankTransferReports(sql) }));
  } finally {
    await sql.end({ timeout: 10 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
