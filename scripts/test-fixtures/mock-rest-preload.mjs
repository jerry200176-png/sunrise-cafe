// Synthetic-only fetch replacement for the subprocess tests; it performs no I/O.
const scenario = JSON.parse(process.env.SYNTHETIC_SCENARIO);
globalThis.fetch = async (url) => {
  const selected = scenario.responses?.find((item) => url.includes(item.match)) ?? scenario.default;
  if (selected.throw) throw new Error("synthetic transport failure");
  return new Response(selected.body, { status: selected.status, headers: { "Content-Type": "application/json" } });
};
