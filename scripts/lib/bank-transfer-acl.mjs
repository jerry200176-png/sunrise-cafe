/** Read-only effective-permission checks for the existing bank-transfer RPC policy. */
export const BANK_TRANSFER_FUNCTIONS = [
  "record_bank_transfer_report(uuid,text,numeric)",
  "confirm_bank_transfer_payment(uuid,text,text)",
];

export function assertBankTransferPrivileges(privilege) {
  const expected = {
    public_report: false, public_confirm: false,
    anon_report: false, anon_confirm: false,
    authenticated_report: false, authenticated_confirm: false,
    service_report: true, service_confirm: true,
  };
  const mismatched = Object.entries(expected).filter(([key, value]) => privilege?.[key] !== value).map(([key]) => key);
  if (mismatched.length) {
    throw new Error(`Bank-transfer RPC permission verification failed: ${mismatched.join(", ")}`);
  }
}

export async function verifyBankTransferAcl(sql) {
  const privileges = await sql`
    SELECT
      has_function_privilege('public', 'public.record_bank_transfer_report(uuid,text,numeric)', 'EXECUTE') AS public_report,
      has_function_privilege('public', 'public.confirm_bank_transfer_payment(uuid,text,text)', 'EXECUTE') AS public_confirm,
      has_function_privilege('anon', 'public.record_bank_transfer_report(uuid,text,numeric)', 'EXECUTE') AS anon_report,
      has_function_privilege('anon', 'public.confirm_bank_transfer_payment(uuid,text,text)', 'EXECUTE') AS anon_confirm,
      has_function_privilege('authenticated', 'public.record_bank_transfer_report(uuid,text,numeric)', 'EXECUTE') AS authenticated_report,
      has_function_privilege('authenticated', 'public.confirm_bank_transfer_payment(uuid,text,text)', 'EXECUTE') AS authenticated_confirm,
      has_function_privilege('service_role', 'public.record_bank_transfer_report(uuid,text,numeric)', 'EXECUTE') AS service_report,
      has_function_privilege('service_role', 'public.confirm_bank_transfer_payment(uuid,text,text)', 'EXECUTE') AS service_confirm
  `;
  if (!Array.isArray(privileges) || privileges.length !== 1) {
    throw new Error("Bank-transfer RPC permission verification failed");
  }
  assertBankTransferPrivileges(privileges[0]);
  const functionAcl = await sql`
    SELECT p.oid::regprocedure::text AS signature, owner.rolname AS owner,
      COALESCE(array_to_string(p.proacl, ','), '') AS acl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles owner ON owner.oid = p.proowner
    WHERE n.nspname = 'public'
      AND p.oid::regprocedure::text = ANY(${sql.array(BANK_TRANSFER_FUNCTIONS)})
    ORDER BY signature
  `;
  if (!Array.isArray(functionAcl) || functionAcl.length !== BANK_TRANSFER_FUNCTIONS.length ||
      BANK_TRANSFER_FUNCTIONS.some((signature) => !functionAcl.some((row) => row.signature === signature))) {
    throw new Error("Bank-transfer RPC ACL metadata is incomplete");
  }
  return { privilege_probe: privileges[0], function_acl: functionAcl };
}
