-- Exact row counts for every base table in schema public, one consistent
-- read-only snapshot. Emits only `table=count` lines (see scripts/db-drill/lib.sh).
SET default_transaction_read_only = on;
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT format('SELECT %L || ''='' || count(*) FROM public.%I', table_name, table_name)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name \gexec
COMMIT;
