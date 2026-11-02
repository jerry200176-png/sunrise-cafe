#!/usr/bin/env node
// Retired migration entry point: fail closed without connecting or running SQL.
console.error("This migration runner is retired. Use the separately reviewed verification or repair process; no migration or database verification was performed.");
process.exitCode = 1;
