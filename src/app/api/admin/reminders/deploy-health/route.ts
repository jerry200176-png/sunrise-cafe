import { NextRequest, NextResponse } from "next/server";
import { fetchExpectedMainHead } from "@/lib/expected-main-head";
import { fetchProductionVersion } from "@/lib/production-version";
import { notifyDeployMismatch } from "@/lib/deploy-alert";
import { errorToDetail } from "@/lib/cron-alert";
import { runCronJob } from "@/lib/job-runs";
import { runBootstrapMigrations } from "@/lib/bootstrap-migrations";
import { authorizeCronGet } from "@/lib/cron-request-auth";
import { checkLineAccountsAndAlert } from "@/lib/line-account-audit";
import { isLineConfigured, sendLineMessage } from "@/lib/line-notify";

async function handleRun() {
  try {
    await runBootstrapMigrations();
    // 客人通知的 token 若其實是店員群組 Bot，兩邊共用同一份額度：每天檢查一次，錯了就通知群組
    if (isLineConfigured()) await checkLineAccountsAndAlert((text) => sendLineMessage(text));

    const [mainHead, prod] = await Promise.all([fetchExpectedMainHead(), fetchProductionVersion()]);

    if (!mainHead) {
      return NextResponse.json({ ok: false, error: "Could not resolve trusted deployment head" }, { status: 503 });
    }
    if (!prod.reachable || !prod.commit) {
      return NextResponse.json({ ok: false, error: "Production /api/version unreachable" }, { status: 503 });
    }

    const mainSha = mainHead.sha;
    if (prod.commit.toLowerCase() === mainSha) {
      return NextResponse.json({
        ok: true,
        sha_parity: true,
        main: mainSha.slice(0, 7),
        prod: prod.commit_short,
      });
    }

    // BI snapshot / docs-only commits intentionally skip Vercel. The trusted
    // workflow records this classification so runtime never needs GitHub API.
    if (mainHead.runtimeChanged === false) {
      return NextResponse.json({
        ok: true,
        sha_parity: true,
        exact_match: false,
        benign_drift: true,
        main: mainSha.slice(0, 7),
        prod: prod.commit_short,
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
