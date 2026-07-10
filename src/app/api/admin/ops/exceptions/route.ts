import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const date = request.nextUrl.searchParams.get("date");
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  const base = new URL(request.url);

  const res = await fetch(new URL(`/api/admin/ops/morning-summary${q}`, base.origin), {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  });
  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return NextResponse.json({
    date: data.date,
    exceptions: data.exceptions,
    today: data.today,
  });
}
