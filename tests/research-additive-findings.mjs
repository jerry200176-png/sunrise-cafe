// Read-only classification check for the exact #502 SQL, not a gate exemption.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lintSql } from '../scripts/lib/sql-additive-lint.mjs';

const sql = readFileSync(new URL('../supabase/migrations/20261031173613_reservation_order_add_items_idempotency.sql', import.meta.url), 'utf8');
assert.equal(createHash('sha256').update(sql).digest('hex'), 'e667bd204cc2038114b291da62764c3d498f40f310c518dee626f829ead80d97');
const findings = lintSql(sql).map(({ line, rule }) => [line, rule]);
assert.deepEqual(findings, [
  [15, 'revoke'], [18, 'create-or-replace'], [72, 'update'], [79, 'revoke'],
  [80, 'dynamic-sql'], [84, 'create-or-replace'], [104, 'revoke'], [105, 'dynamic-sql'],
  [111, 'create-or-replace'], [128, 'revoke'], [132, 'create-or-replace'],
  [137, 'update'], [141, 'revoke'],
]);
console.log('Exact candidate SQL hash and all 13 additive-gate findings match the review package.');
