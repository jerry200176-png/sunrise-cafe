import { NextRequest, NextResponse } from "next/server";
import { fetchMainCommitSha } from "@/lib/github-main-sha";
import { fetchProductionVersion } from "@/lib/production-version";
import { notifyDeployMismatch } from "@/lib/deploy-alert";
import { errorToDetail } from "@/lib/cron-alert";
import { runCronJob } from "@/lib/job-runs";
import { runBootstrapMigrations } from "@/lib/bootstrap-migrations";

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

    const parity = prod.commit === mainSha;
    if (parity) {
      return NextResponse.json({
        ok: true,
        sha_parity: true,
        main: mainSha.slice(0, 7),
        prod: prod.commit_short,
      });
    }

    const alerted = await notifyDeployMismatch({ mainSha, prodSha: prod.commit });
    return NextResponse.json({
      ok: false,
      sha_parity: false,
      main: mainSha.slice(0, 7),
      prod: prod.commit_short,
      alerted,
      hint: "Run vercel deploy --prod or check Vercel dashboard",
    });
  } catch (err) {
    return NextResponse.json({ error: errorToDetail(err) }, { status: 500 });
  }
}

/** GET: Vercel Cron — production SHA parity check + LINE alert on drift */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  return runCronJob("deploy-health", () => handleRun());
}

/** POST: manual trigger (admin session or cron secret via middleware) */
export async function POST() {
  return runCronJob("deploy-health", () => handleRun());
}
