// Synthetic-only guard: legacy stubs must not try any network request.
globalThis.fetch = () => {
  process.stderr.write("UNEXPECTED_FETCH\n");
  throw new Error("UNEXPECTED_FETCH");
};
