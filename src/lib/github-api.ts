/** Shared GitHub API policy for server-side operational checks. */

export const GITHUB_API_REQUEST_TIMEOUT_MS = 5_000;
export const GITHUB_API_RETRY_DELAYS_MS = [250, 1_000] as const;

export function githubApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function isRetryableGithubResponse(response: Response): boolean {
  if (response.status === 408 || response.status === 425 || response.status === 429) {
    return true;
  }
  if (response.status >= 500 && response.status <= 599) return true;

  // GitHub uses 403 for rate limiting as well as permission failures. Retry
  // only when the response identifies rate limiting; a normal 403 is a hard
  // credential/permission failure and should still alert immediately.
  return (
    response.status === 403 &&
    (response.headers?.get("x-ratelimit-remaining") === "0" ||
      Boolean(response.headers?.get("retry-after")))
  );
}

export function waitForGithubRetry(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
