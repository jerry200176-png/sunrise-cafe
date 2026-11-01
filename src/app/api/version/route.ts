import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 部署版本檢查：用來確認線上是否已更新。
 * 新版本才有此 API；若回傳 404 表示仍是舊部署。
 */
export async function GET() {
  return NextResponse.json({
    deployed: "v2",
    note: "若能看到此 API，表示網站已更新為最新部署",
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
