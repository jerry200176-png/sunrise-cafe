import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import {
  buildMorningSummaryContext,
  todayTaipeiDateString,
} from "@/lib/morning-summary-context";
import { sendLineMessageToGroup, sendLineMessage, isLineConfigured } from "@/lib/line-notify";
import { startJobRun, finishJobRun } from "@/lib/admin-users";

function verifyCronOrAdmin(request: NextRequest): Promise<NextResponse | null> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return Promise.resolve(null);
  }
  return requireAdminApiAuth(request);
}

export async function GET(request: NextRequest) {
  const denied = await verifyCronOrAdmin(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const date = request.nextUrl.searchParams.get("date") || todayTaipeiDateString();
  const push = request.nextUrl.searchParams.get("push") !== "0";
  let jobId: string | null = null;

  try {
    jobId = await startJobRun("morning-summary");
    const ctx = await buildMorningSummaryContext(date);
    const results: { target: string; ok: boolean; error?: string }[] = [];

    if (push) {
      const activeBranches = ctx.branches.filter((b) => b.line_group_id);
      const useLegacy = activeBranches.length === 0;

      if (useLegacy) {
        if (isLineConfigured()) {
          try {
            await sendLineMessage(ctx.line_message);
            results.push({ target: "legacy_group", ok: true });
          } catch (err) {
            results.push({
              target: "legacy_group",
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          results.push({ target: "legacy_group", ok: false, error: "LINE 未設定" });
        }
      } else {
        for (const b of activeBranches) {
          try {
            const text = `【${b.name}】\n${ctx.line_message}`;
            await sendLineMessageToGroup(text, b.line_group_id!);
            results.push({ target: b.name, ok: true });
          } catch (err) {
            results.push({
              target: b.name,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    await finishJobRun(jobId, {
      status: "completed",
      items_processed: results.length,
      metadata: { date, pushed: push },
    });

    return NextResponse.json({
      ok: true,
      date: ctx.date,
      line_message: ctx.line_message,
      pushed: push,
      results,
    });
  } catch (err) {
    await finishJobRun(jobId, {
      status: "failed",
      error_message: err instanceof Error ? err.message : String(err),
    });
    const message = err instanceof Error ? err.message : "晨報推播失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}