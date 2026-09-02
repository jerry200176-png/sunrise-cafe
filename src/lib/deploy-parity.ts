import {
  GITHUB_API_REQUEST_TIMEOUT_MS,
  GITHUB_API_RETRY_DELAYS_MS,
  githubApiHeaders,
  isRetryableGithubResponse,
  waitForGithubRetry,
} from "@/lib/github-api";

/**
 * Assess whether main↔prod SHA drift needs a deploy / LINE alert.
 *
 * Daily BI snapshots commit with `[skip ci]` and only touch non-runtime paths
 * (e.g. orchestrator/business-snapshot.json). That advances main without a
 * Vercel production build — not a customer-facing deploy failure.
 */

const REPO = "jerry200176-png/sunrise-cafe";

/** Path prefixes that never affect the running Next.js production app. */
const BENIGN_PATH_PREFIXES = ["orchestrator/", "docs/"] as const;

const BENIGN_EXACT_PATHS = new Set([
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "GOVERNANCE_STATUS.md",
  "README.md",
]);

export function isBenignDeployPath(filename: string): boolean {
  if (BENIGN_EXACT_PATHS.has(filename)) return true;
  return BENIGN_PATH_PREFIXES.some((prefix) => filename.startsWith(prefix));
}

export type DeployParityAssessment = {
  exactMatch: boolean;
  /** Drift exists but only non-runtime paths differ — no deploy/alert needed. */
  benignDrift: boolean;
  changedFiles: string[];
  compareOk: boolean;
};

type GithubCompareResponse = {
  files?: Array<{ filename?: string }>;
  status?: string;
};

type DeployParityOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

/**
 * Compare prodSha...mainSha via public GitHub API.
 * On API failure, compareOk=false so callers can fall back to alerting.
 */
export async function assessDeployParity(
  prodSha: string,
  mainSha: string,
  options: DeployParityOptions = {}
): Promise<DeployParityAssessment> {
  if (prodSha === mainSha) {
    return { exactMatch: true, benignDrift: false, changedFiles: [], compareOk: true };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? waitForGithubRetry;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetchImpl(
        `https://api.github.com/repos/${REPO}/compare/${prodSha}...${mainSha}`,
        {
          headers: githubApiHeaders(),
          cache: "no-store",
          signal: AbortSignal.timeout(GITHUB_API_REQUEST_TIMEOUT_MS),
        }
      );
      if (!res.ok) {
        console.error("[deploy-parity] GitHub compare", res.status, `attempt=${attempt}`);
        if (!isRetryableGithubResponse(res) || attempt === 3) {
          return { exactMatch: false, benignDrift: false, changedFiles: [], compareOk: false };
        }
      } else {
        const body = (await res.json()) as GithubCompareResponse;
        const changedFiles = (body.files ?? [])
          .map((f) => f.filename)
          .filter((name): name is string => typeof name === "string" && name.length > 0);

        // Empty file list with ahead status can happen for empty commits — treat as benign.
        const benignDrift =
          changedFiles.length === 0 || changedFiles.every((f) => isBenignDeployPath(f));

        return {
          exactMatch: false,
          benignDrift,
          changedFiles,
          compareOk: true,
        };
      }
    } catch (err) {
      console.error("[deploy-parity] compare failed", `attempt=${attempt}:`, err);
      if (attempt === 3) {
        return { exactMatch: false, benignDrift: false, changedFiles: [], compareOk: false };
      }
    }

    if (attempt < 3) {
      const delay =
        GITHUB_API_RETRY_DELAYS_MS[attempt - 1] ?? GITHUB_API_RETRY_DELAYS_MS.at(-1)!;
      await sleep(delay);
    }
  }

  return { exactMatch: false, benignDrift: false, changedFiles: [], compareOk: false };
}
