-- READ ONLY: ACL/RLS and identity metadata only; no branch row values.
-- A project ref is NOT derivable from current_database() alone. Correlate this
-- connection with a trusted external target record without printing credentials.
SELECT current_user AS connection_role, current_database() AS database_name,
       current_setting('server_version') AS postgres_version;
SELECT n.nspname AS schema_name, c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity,
       c.relacl::text AS table_acl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.oid='public.branches'::regclass;
SELECT a.attname AS column_name, a.attacl::text AS column_acl,
       has_column_privilege('anon',a.attrelid,a.attnum,'SELECT') AS anon_select,
       has_column_privilege('authenticated',a.attrelid,a.attnum,'SELECT') AS authenticated_select,
       has_column_privilege('service_role',a.attrelid,a.attnum,'SELECT') AS service_select
FROM pg_attribute a WHERE a.attrelid='public.branches'::regclass
  AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname;
SELECT r.rolname, r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolbypassrls,
       has_table_privilege(r.oid,'public.branches','SELECT') AS table_select,
       has_table_privilege(r.oid,'public.branches','TRUNCATE') AS table_truncate
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','authenticator')
ORDER BY r.rolname;
SELECT member.rolname AS member, parent.rolname AS granted_role, m.inherit_option, m.set_option, m.admin_option
FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member
JOIN pg_roles parent ON parent.oid=m.roleid
WHERE member.rolname IN ('anon','authenticated','service_role','authenticator')
   OR parent.rolname IN ('anon','authenticated','service_role')
ORDER BY member.rolname,parent.rolname;
SELECT polname, polcmd, polpermissive, polroles::text,
       pg_get_expr(polqual,polrelid) AS using_expr,
       pg_get_expr(polwithcheck,polrelid) AS check_expr
FROM pg_policy WHERE polrelid='public.branches'::regclass ORDER BY polname;
