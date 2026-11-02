/**
 * Research-only, per-tab conservative warning ledger.
 * No reservation IDs, names, room names, telephone numbers, or order data are
 * stored. This is neither an idempotency key nor proof of a server outcome.
 */
export const ADD_WARNING_KEY = "sunrise:add-outcomes:v1";
const MAX_ENTRIES = 64;
type Status = "pending" | "unknown" | "committed";
type Entry = { n: string; status: Status };
type Snapshot = { version: 1; entries: Entry[] };
type StorageLike = Pick<Storage, "getItem" | "setItem">;
type ReadResult = { ok: true; value: Snapshot } | { ok: false };
type StartResult = { ok: true; operation: string } | { ok: false };

function read(storage: StorageLike): ReadResult {
  try {
    const text = storage.getItem(ADD_WARNING_KEY);
    if (text === null) return { ok: true, value: { version: 1, entries: [] } };
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
    const raw = value as Record<string, unknown>;
    if (Object.keys(raw).sort().join(",") !== "entries,version" || raw.version !== 1 ||
      !Array.isArray(raw.entries) || raw.entries.length > MAX_ENTRIES) return { ok: false };
    const seen = new Set<string>();
    const entries: Entry[] = [];
    for (const candidate of raw.entries) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { ok: false };
      const row = candidate as Record<string, unknown>;
      if (Object.keys(row).sort().join(",") !== "n,status" || typeof row.n !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.n) || seen.has(row.n) ||
        (row.status !== "pending" && row.status !== "unknown" && row.status !== "committed")) return { ok: false };
      seen.add(row.n as string);
      entries.push({ n: row.n as string, status: row.status });
    }
    return { ok: true, value: { version: 1, entries } };
  } catch {
    // Storage may be disabled, full, unavailable or contain untrusted data.
    return { ok: false };
  }
}

function write(storage: StorageLike, snapshot: Snapshot): boolean {
  try {
    const encoded = JSON.stringify(snapshot);
    storage.setItem(ADD_WARNING_KEY, encoded);
    return storage.getItem(ADD_WARNING_KEY) === encoded;
  } catch { return false; }
}

export function createSessionAddWarningResearch(storage: StorageLike) {
  function snapshot(): ReadResult { return read(storage); }
  function begin(): StartResult {
    const current = read(storage);
    if (!current.ok || current.value.entries.length >= MAX_ENTRIES) return { ok: false };
    let operation: string;
    try { operation = crypto.randomUUID(); } catch { return { ok: false }; }
    if (current.value.entries.some((entry) => entry.n === operation)) return { ok: false };
    const updated: Snapshot = { ...current.value,
      entries: [...current.value.entries, { n: operation, status: "pending" }] };
    return write(storage, updated) ? { ok: true, operation } : { ok: false };
  }
  function mark(operation: string, status: "unknown" | "committed" | "not_attempted"): boolean {
    const current = read(storage);
    if (!current.ok) return false;
    const entry = current.value.entries.find((row) => row.n === operation);
    if (!entry) return false;
    // A later ambiguous callback cannot erase a previously confirmed commit.
    if (entry.status === "committed" && status !== "committed") return false;
    const entries = status === "not_attempted"
      ? current.value.entries.filter((row) => row.n !== operation)
      : current.value.entries.map((row) => row.n === operation ? { n: row.n, status } : row);
    return write(storage, { ...current.value, entries });
  }
  function acknowledgeCommitted(operation: string): boolean {
    const current = read(storage);
    if (!current.ok) return false;
    const entry = current.value.entries.find((row) => row.n === operation);
    // Pending/unknown can still finish later; an unrelated reload cannot settle it.
    if (!entry || entry.status !== "committed") return false;
    return write(storage, { ...current.value, entries: current.value.entries.filter((row) => row.n !== operation) });
  }
  return { snapshot, begin, mark, acknowledgeCommitted };
}
