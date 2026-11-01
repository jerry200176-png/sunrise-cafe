#!/usr/bin/env node
/** Standalone ACL inspection. There is deliberately no write/apply mode. */
import { connectOpsPostgres } from "./lib/ops-postgres.mjs";
import { verifyBankTransferAcl } from "./lib/bank-transfer-acl.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function auditBankTransferAcl(sql) {
  return sql.begin("isolation level repeatable read read only", (transaction) => verifyBankTransferAcl(transaction));
}

async function main() {
  if (process.argv.length !== 2) {
    console.error("Usage: node scripts/audit-bank-transfer-acl.mjs (read-only; no options)");
    process.exitCode = 2;
    return;
  }
  const sql = await connectOpsPostgres();
  try {
    const result = await auditBankTransferAcl(sql);
    console.log(JSON.stringify({ audit: "bank_transfer_acl", status: "verified", ...result }));
  } finally {
    await sql.end({ timeout: 10 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "";
    console.error(message.startsWith("Bank-transfer RPC") || message.startsWith("Missing usable")
      ? message : "Bank-transfer ACL audit failed; check connectivity and permissions.");
    process.exitCode = 1;
  });
}
