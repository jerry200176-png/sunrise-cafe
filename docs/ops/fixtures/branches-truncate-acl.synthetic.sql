-- SYNTHETIC REVIEW FIXTURE ONLY; not an approved or deployable production migration.
-- Target identity, consumers, complete ACL, rollback and governance require separate review.
BEGIN;
DO $database_guard$ BEGIN
  IF current_database() <> 'sunrise_privacy_fixture' THEN
    RAISE EXCEPTION 'synthetic fixture requires its disposable test database';
  END IF;
END $database_guard$;
LOCK TABLE public.branches IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF NOT has_table_privilege('anon','public.branches','TRUNCATE')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon' AND (rolsuper OR rolbypassrls))
    OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname <> 'anon' AND pg_has_role('anon',r.oid,'MEMBER'))
    OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) p
      WHERE c.oid='public.branches'::regclass AND p.grantee=0 AND p.privilege_type='TRUNCATE') THEN
    RAISE EXCEPTION 'unexpected fixture truncate ACL';
  END IF;
END $guard$;
REVOKE TRUNCATE ON TABLE public.branches FROM anon;
DO $check$ BEGIN
  IF has_table_privilege('anon','public.branches','TRUNCATE') THEN
    RAISE EXCEPTION 'anon TRUNCATE remains';
  END IF;
END $check$;
COMMIT;
