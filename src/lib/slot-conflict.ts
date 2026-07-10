/** Thrown when PostgreSQL exclusion constraint blocks overlapping reservation insert */
export class SlotConflictError extends Error {
  constructor(message = "該時段已被預訂，請重新選擇") {
    super(message);
    this.name = "SlotConflictError";
  }
}

export function isPostgresExclusionViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23P01"
  );
}

export function isPostgresUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}
