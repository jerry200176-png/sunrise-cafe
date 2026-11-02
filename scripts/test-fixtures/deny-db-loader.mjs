// Synthetic test guard: make a Postgres import visible and prevent a DB connection.
export function resolve(specifier, context, nextResolve) {
  if (specifier === "postgres") {
    process.stderr.write("UNEXPECTED_DB_IMPORT\n");
    throw new Error("UNEXPECTED_DB_IMPORT");
  }
  return nextResolve(specifier, context);
}
