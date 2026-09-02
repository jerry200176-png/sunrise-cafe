/**
 * Trusted main-head metadata recorded by the repository's production workflow.
 *
 * Production deliberately does not call GitHub: the private repository is
 * resolved in GitHub Actions, where the platform supplies a short-lived,
 * repository-scoped identity. The workflow records the result in ops_events;
 * this reader only accepts that exact event shape.
 */

const REQUEST_TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [250, 1_000] as const;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export type ExpectedMainHead = {
  sha: string;
  /** null means the writer could not safely classify the changed paths. */
  runtimeChanged: boolean | null;
  recordedAt: string | null;
};

type ExpectedMainHeadOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/** Parse the narrow REST response shape used by deploy-health. */
export function parseExpectedMainHead(payload: unknown): ExpectedMainHead | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const row = payload[0];
  if (!row || typeof row !== "object") return null;
  const detail = "detail" in row && row.detail && typeof row.detail === "object" ? row.detail : null;
  if (!detail || !("sha" in detail) || typeof detail.sha !== "string") return null;
  if (!SHA_PATTERN.test(detail.sha)) return null;
  if (detail.source !== "github-actions") return null;

  const runtimeChanged =
    "runtime_changed" in detail && typeof detail.runtime_changed === "boolean"
      ? detail.runtime_changed
      : null;
  const recordedAt =
    "ts" in row && typeof row.ts === "string"
      ? row.ts
      : "recorded_at" in detail && typeof detail.recorded_at === "string"
        ? detail.recorded_at
        : null;

  return { sha: detail.sha.toLowerCase(), runtimeChanged, recordedAt };
}

/** Read the latest workflow-recorded main head without contacting GitHub. */
export async function fetchExpectedMainHead(
  options: ExpectedMainHeadOptions = {}
): Promise<ExpectedMainHead | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!baseUrl || !serviceKey) return null;

  const query = new URLSearchParams({
    select: "detail,ts",
    domain: "eq.deployment",
    action: "eq.main_head",
    order: "ts.desc",
    limit: "1",
  });
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(`${baseUrl}/rest/v1/ops_events?${query.toString()}`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        return parseExpectedMainHead(await response.json());
      }

      console.error("[expected-main-head] Supabase read", response.status, `attempt=${attempt}`);
      if (!isRetryableStatus(response.status) || attempt === 3) return null;
    } catch (error) {
      console.error("[expected-main-head] Supabase read failed", `attempt=${attempt}:`, error);
      if (attempt === 3) return null;
    }

    await sleep(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS.at(-1)!);
  }

  return null;
}
