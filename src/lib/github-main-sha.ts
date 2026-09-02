import {
  GITHUB_API_REQUEST_TIMEOUT_MS,
  GITHUB_API_RETRY_DELAYS_MS,
  githubApiHeaders,
  isRetryableGithubResponse,
  waitForGithubRetry,
} from "@/lib/github-api";

/**
 * Resolve latest main branch commit from GitHub.
 *
 * The repository is private, so production must provide GITHUB_TOKEN. A
 * missing/invalid credential remains a hard failure; retries are only for
 * failures that may recover (network errors, timeouts, rate limits, and 5xx).
 */
const REPO = "jerry200176-png/sunrise-cafe";
const MAX_ATTEMPTS = 3;

type FetchMainCommitOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
};

type GithubCommitResponse = {
  sha?: unknown;
};

function isFullSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

export async function fetchMainCommitSha(
  options: FetchMainCommitOptions = {}
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? waitForGithubRetry;
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? MAX_ATTEMPTS));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetchImpl(`https://api.github.com/repos/${REPO}/commits/main`, {
        headers: githubApiHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(GITHUB_API_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error("[github-main-sha] GitHub API", res.status, `attempt=${attempt}`);
        if (!isRetryableGithubResponse(res)) return null;
      } else {
        const body = (await res.json()) as GithubCommitResponse;
        if (isFullSha(body.sha)) return body.sha;
        console.error("[github-main-sha] GitHub response did not contain a full SHA");
      }
    } catch (err) {
      console.error("[github-main-sha] fetch failed", `attempt=${attempt}:`, err);
    }

    if (attempt < maxAttempts) {
      const delay =
        GITHUB_API_RETRY_DELAYS_MS[attempt - 1] ?? GITHUB_API_RETRY_DELAYS_MS.at(-1)!;
      await sleep(delay);
    }
  }

  return null;
}
