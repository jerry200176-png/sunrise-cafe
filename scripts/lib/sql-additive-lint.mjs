/**
 * Additive-only SQL linter (RULEBOOK F1 gate). Pure functions, no I/O.
 *
 * Flags statements that destroy or rewrite existing data or schema:
 * DROP, RENAME, ALTER COLUMN ... TYPE, TRUNCATE, DELETE FROM, UPDATE.
 * Constraint swaps are caught because they need DROP CONSTRAINT.
 *
 * Seed exemption (UPDATE only, never DROP/DELETE/TRUNCATE): wrap an idempotent
 * seed in `-- additive-lint: allow-update <reason>` ... `-- additive-lint: end-allow-update`.
 */

export const RULES = [
  { id: "drop", re: /\bDROP\b/gi, hint: "DROP (table/column/constraint/policy/index/function)" },
  { id: "rename", re: /\bRENAME\b/gi, hint: "RENAME" },
  { id: "alter-type", re: /\bALTER\s+(?:COLUMN\s+)?"?[\w.]+"?\s+(?:SET\s+DATA\s+)?TYPE\b/gi, hint: "ALTER COLUMN ... TYPE" },
  { id: "alter-set-not-null", re: /\bALTER\s+(?:COLUMN\s+)?"?[\w.]+"?\s+SET\s+NOT\s+NULL\b/gi, hint: "ALTER COLUMN ... SET NOT NULL" },
  { id: "alter-set-default", re: /\bALTER\s+(?:COLUMN\s+)?"?[\w.]+"?\s+SET\s+DEFAULT\b/gi, hint: "ALTER COLUMN ... SET DEFAULT" },
  { id: "alter-policy", re: /\bALTER\s+POLICY\b/gi, hint: "ALTER POLICY" },
  { id: "disable-security", re: /\b(?:DISABLE\s+ROW\s+LEVEL\s+SECURITY|NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY|DISABLE\s+TRIGGER)\b/gi, hint: "DISABLE ROW LEVEL SECURITY / NO FORCE / DISABLE TRIGGER" },
  { id: "revoke", re: /\bREVOKE\b/gi, hint: "REVOKE" },
  { id: "create-or-replace", re: /\bCREATE\s+OR\s+REPLACE\b/gi, hint: "CREATE OR REPLACE (rewrites an existing object)" },
  // Dynamic SQL hides any statement from this linter: fail closed. Trigger syntax
  // "EXECUTE FUNCTION/PROCEDURE" is not dynamic SQL.
  { id: "dynamic-sql", re: /\bEXECUTE\b(?!\s+(?:FUNCTION|PROCEDURE)\b)|\bdblink_exec\b/gi, hint: "EXECUTE / dynamic SQL (cannot be verified additive)" },
  { id: "truncate", re: /\bTRUNCATE\b/gi, hint: "TRUNCATE" },
  { id: "delete", re: /\bDELETE\s+FROM\b/gi, hint: "DELETE FROM" },
  {
    id: "update",
    re: /\bUPDATE\s+(?:ONLY\s+)?[\w."]+(?:\s+(?:AS\s+)?[a-z_]\w*)?\s+SET\b|\bDO\s+UPDATE\s+SET\b/gi,
    hint: "UPDATE / ON CONFLICT DO UPDATE",
    exemptible: true,
  },
];

const ALLOW_BEGIN = /^\s*--\s*additive-lint:\s*allow-update\s+\S+/i;
const ALLOW_END = /^\s*--\s*additive-lint:\s*end-allow-update\b/i;

/** Remove comments and single-quoted string contents; keep newlines so line numbers survive. */
export function stripSql(input) {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    const n = input[i + 1];
    if (c === "-" && n === "-") {
      out += " ";
      while (i < input.length && input[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      out += " ";
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) {
        if (input[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
    } else if (c === "'") {
      out += "''";
      i++;
      while (i < input.length) {
        if (input[i] === "'" && input[i + 1] === "'") i += 2;
        else if (input[i] === "'") { i++; break; }
        else { if (input[i] === "\n") out += "\n"; i++; }
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function allowedLines(raw) {
  const allowed = new Set();
  let open = false;
  raw.split("\n").forEach((line, idx) => {
    if (ALLOW_BEGIN.test(line)) { open = true; return; }
    if (ALLOW_END.test(line)) { open = false; return; }
    if (open) allowed.add(idx + 1);
  });
  return { allowed, unterminated: open };
}

/** @returns {{rule:string,line:number,hint:string}[]} */
export function lintSql(raw) {
  const { allowed, unterminated } = allowedLines(raw);
  const code = stripSql(raw);
  const findings = [];
  if (unterminated) findings.push({ rule: "allow-marker", line: 1, hint: "allow-update marker has no end-allow-update" });
  for (const rule of RULES) {
    for (const m of code.matchAll(rule.re)) {
      const line = code.slice(0, m.index).split("\n").length;
      if (rule.exemptible && allowed.has(line)) continue;
      findings.push({ rule: rule.id, line, hint: rule.hint });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

// grandfathered = already applied before this gate existed; the set is frozen by a test.
export const SQL_CLASSES = new Set(["additive", "grandfathered", "founder_approved"]);

/**
 * Plan gate: every runner entry must declare sql_class. "additive" is re-linted
 * at execution time (fail closed); "founder_approved" needs an approval reference
 * (the Founder's decision, RULEBOOK F1); "grandfathered" is a frozen legacy list.
 * @param {{entries:any[]}} plan
 * @param {(file:string)=>string} readSql
 * @param {string} [phase] limit to one phase
 */
export function assertPlanSqlGate(plan, readSql, phase) {
  const errors = [];
  for (const entry of plan.entries) {
    if (!entry.runner || (phase && entry.phase !== phase)) continue;
    const id = entry.version ?? entry.file;
    if (!SQL_CLASSES.has(entry.sql_class)) {
      errors.push(`${id}: runner entry is not marked sql_class "additive", "grandfathered" or "founder_approved"`);
      continue;
    }
    if (entry.sql_class === "grandfathered") continue;
    if (entry.sql_class === "founder_approved") {
      if (typeof entry.approval !== "string" || !entry.approval.trim()) {
        errors.push(`${id}: founder_approved requires an "approval" reference`);
      }
      continue;
    }
    const findings = lintSql(readSql(entry.file));
    if (findings.length) {
      errors.push(`${id}: marked additive but ${entry.file} has ${findings.map((f) => `${f.rule}@L${f.line}`).join(", ")}`);
    }
  }
  if (errors.length) {
    throw new Error(`Additive-only SQL gate refused to run:\n- ${errors.join("\n- ")}`);
  }
}
