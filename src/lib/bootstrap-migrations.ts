/**
 * Historical cold-start migrations are disabled. Schema readiness and any
 * migration must use a separately reviewed deployment path. In particular,
 * a missing, stale or unauthorized REST response must not trigger DDL.
 */
export async function runBootstrapMigrations(): Promise<void> {
  // Compatibility no-op for existing callers. This is not a readiness check.
}
