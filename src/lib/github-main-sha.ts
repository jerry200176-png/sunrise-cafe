/**
 * Resolve latest main branch commit from GitHub (public API).
 */
const REPO = "jerry200176-png/sunrise-cafe";

export async function fetchMainCommitSha(): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("[github-main-sha] GitHub API", res.status);
      return null;
    }
    const body = (await res.json()) as { sha?: string };
    return body.sha ?? null;
  } catch (err) {
    console.error("[github-main-sha] fetch failed:", err);
    return null;
  }
}
