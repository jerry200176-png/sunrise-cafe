/** Shared connection setup. Callers determine whether their transaction is read-only. */
export async function connectOpsPostgres() {
  const connectionString = process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ?? process.env.DATABASE_URL ?? "";
  if (!connectionString || /[\[<](?:region|ref|YOUR|PASSWORD)/i.test(connectionString)) {
    throw new Error("Missing usable SUPABASE_DB_URL/POSTGRES_URL; explicit migration execution is fail-closed");
  }
  const local = /(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(connectionString);
  const { default: postgres } = await import("postgres");
  return postgres(connectionString, { max: 1, idle_timeout: 15, ...(local ? { ssl: false } : { ssl: "require" }) });
}
