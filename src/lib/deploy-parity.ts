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

/**
 * Compare prodSha...mainSha via public GitHub API.
 * On API failure, compareOk=false so callers can fall back to alerting.
 */
export async function assessDeployParity(
  prodSha: string,
  mainSha: string
): Promise<DeployParityAssessment> {
  if (prodSha === mainSha) {
    return { exactMatch: true, benignDrift: false, changedFiles: [], compareOk: true };
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/compare/${prodSha}...${mainSha}`,
      {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      console.error("[deploy-parity] GitHub compare", res.status);
      return { exactMatch: false, benignDrift: false, changedFiles: [], compareOk: false };
    }

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
  } catch (err) {
    console.error("[deploy-parity] compare failed:", err);
    return { exactMatch: false, benignDrift: false, changedFiles: [], compareOk: false };
  }
}
