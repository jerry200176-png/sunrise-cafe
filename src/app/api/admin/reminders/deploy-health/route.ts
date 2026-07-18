import { NextRequest, NextResponse } from "next/server";
import { fetchMainCommitSha } from "@/lib/github-main-sha";
import { fetchProductionVersion } from "@/lib/production-version";
import { assessDeployParity } from "@/lib/deploy-parity";
import { notifyDeployMismatch } from "@/lib/deploy-alert";
import { errorToDetail } from "@/lib/cron-alert";
import { runCronJob } from "@/lib/job-runs";
import { runBootstrapMigrations } from "@/lib/bootstrap-migrations";
import { authorizeCronGet } from "@/lib/cron-request-auth";

async function handleRun() {
  try {
    await runBootstrapMigrations();

    const [mainSha, prod] = await Promise.all([fetchMainCommitSha(), fetchProductionVersion()]);

    if (!mainSha) {
      return NextResponse.json({ ok: false, error: "Could not resolve main branch SHA" }, { status: 503 });
    }
    if (!prod.reachable || !prod.commit) {
      return NextResponse.json({ ok: false, error: "Production /api/version unreachable" }, { status: 503 });
    }

    const assessment = await assessDeployParity(prod.commit, mainSha);
    if (assessment.exactMatch) {
      return NextResponse.json({
        ok: true,
        sha_parity: true,
        main: mainSha.slice(0, 7),
        prod: prod.commit_short,
      });
    }

    // BI snapshot / docs-only commits use [skip ci] and intentionally skip Vercel.
    // Exact tip mismatch is expected; do not page the LINE group.
    if (assessment.compareOk && assessment.benignDrift) {
      return NextResponse.json({
        ok: true,
        sha_parity: true,
        exact_match: false,
        benign_drift: true,
        main: mainSha.slice(0, 7),
        prod: prod.commit_short,
        changed_files: assessment.changedFiles,
        hint: "main tip only differs on non-runtime paths (BI/docs) — no production deploy needed",
      });
    }

    const alerted = await notifyDeployMismatch({ mainSha, prodSha: prod.commit });
    return NextResponse.json({
      ok: false,
      sha_parity: false,
      main: mainSha.slice(0, 7),
      prod: prod.commit_short,
      alerted,
      changed_files: assessment.changedFiles,
      hint: "Run vercel deploy --prod or check Vercel dashboard",
    });
  } catch (err) {
    return NextResponse.json({ error: errorToDetail(err) }, { status: 500 });
  }
}

/** GET: Vercel Cron — production SHA parity check + LINE alert on drift */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronGet(request);
  if (!cronAuth.ok) return cronAuth.response;
  return runCronJob("deploy-health", () => handleRun());
}

/** POST: manual trigger (admin session or cron secret via middleware) */
export async function POST() {
  return runCronJob("deploy-health", () => handleRun());
}
