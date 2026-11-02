// Synthetic-only fetch replacement for the subprocess tests; it performs no I/O.
const scenario = JSON.parse(process.env.SYNTHETIC_SCENARIO);
globalThis.fetch = async (url, options = {}) => {
  const target = new URL(url);
  if ((options.method ?? "GET") !== "GET" || target.origin !== "https://synthetic.supabase.co" || !target.pathname.startsWith("/rest/v1/") || target.pathname.startsWith("/rest/v1/rpc/") || target.searchParams.get("limit") !== "0" || options.redirect !== "error") {
    throw new Error("unexpected non-read-only REST request");
  }
  const selected = scenario.responses?.find((item) => url.includes(item.match)) ?? scenario.default;
  if (selected.throw) throw new Error("synthetic transport failure");
  return new Response(selected.body, { status: selected.status, headers: { "Content-Type": "application/json" } });
};
