import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import {
  buildMorningSummaryContext,
  todayTaipeiDateString,
} from "@/lib/morning-summary-context";

export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const date = request.nextUrl.searchParams.get("date") || todayTaipeiDateString();

  try {
    const ctx = await buildMorningSummaryContext(date);
    return NextResponse.json({
      date: ctx.date,
      today: ctx.today,
      exceptions: ctx.exceptions,
      line_message: ctx.line_message,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "晨報載入失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
