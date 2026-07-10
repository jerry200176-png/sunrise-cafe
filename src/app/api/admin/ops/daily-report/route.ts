import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";

/** Alias: daily business report combines morning summary + BI snapshot pointers */
export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const date = request.nextUrl.searchParams.get("date");
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  const base = new URL(request.url);

  try {
    const [morningRes, biRes, dqRes] = await Promise.all([
      fetch(new URL(`/api/admin/ops/morning-summary${q}`, base.origin), {
        headers: { cookie: request.headers.get("cookie") ?? "" },
      }),
      fetch(new URL(`/api/admin/bi/summary?days=1`, base.origin), {
        headers: { cookie: request.headers.get("cookie") ?? "" },
      }),
      fetch(new URL(`/api/admin/data-quality/report?days=7`, base.origin), {
        headers: { cookie: request.headers.get("cookie") ?? "" },
      }),
    ]);

    const morning = await morningRes.json();
    const bi = biRes.ok ? await biRes.json() : null;
    const dq = dqRes.ok ? await dqRes.json() : null;

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      morning_summary: morning,
      kpis_today: bi?.kpis ?? null,
      data_quality: dq?.summary ?? null,
      links: {
        insights: "/admin/insights",
        data_dictionary: "/docs/DATA_DICTIONARY.md",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "日報產生失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
