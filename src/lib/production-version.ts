/**
 * Live production version — public /api/version (no auth).
 */

const DEFAULT_PROD_URL = "https://sunrise-cafe-six.vercel.app";

export type ProductionVersion = {
  commit: string | null;
  commit_short: string | null;
  deployed: string | null;
  reachable: boolean;
};

export async function fetchProductionVersion(
  prodUrl = process.env.PROD_URL ?? DEFAULT_PROD_URL
): Promise<ProductionVersion> {
  try {
    const res = await fetch(`${prodUrl.replace(/\/$/, "")}/api/version`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { commit: null, commit_short: null, deployed: null, reachable: false };
    }
    const body = (await res.json()) as { commit?: string; deployed?: string };
    const commit = body.commit ?? null;
    return {
      commit,
      commit_short: commit ? commit.slice(0, 7) : null,
      deployed: body.deployed ?? null,
      reachable: true,
    };
  } catch {
    return { commit: null, commit_short: null, deployed: null, reachable: false };
  }
}

export function deploymentShaParity(
  repositoryShort: string | null,
  liveShort: string | null
): boolean | null {
  if (!repositoryShort || !liveShort) return null;
  return repositoryShort === liveShort;
}
