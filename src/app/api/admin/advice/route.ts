import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { resolveBranchScope } from "@/lib/rbac";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { loadAdvice } from "@/lib/advice-data";
import { applyDecisions, type Decision } from "@/lib/business-advice";

const db = (): SupabaseClient => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function loadDecisions(client: SupabaseClient, scope: string[] | null): Promise<Decision[]> {
  let q = client.from("advice_decisions").select("suggestion_id,decision,decided_at,snapshot");
  if (scope) q = q.in("branch_id", scope);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ suggestionId: r.suggestion_id, decision: r.decision, decidedAt: r.decided_at, snapshot: r.snapshot }));
}

/** 經營總覽的建議決策。分店範圍和 /api/admin/overview 完全一致。 */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "bi:read");
  if (denied) return denied;

  const ctx = await getAdminContext(request);
  const scope = resolveBranchScope(ctx, request.nextUrl.searchParams.get("branchId"));
  if (!scope.ok) return NextResponse.json({ error: "Forbidden branch" }, { status: 403 });
  if (!isAdminConfigured()) return NextResponse.json({ error: "後端未設定" }, { status: 503 });

  try {
    const client = db();
    const [advice, decisions] = await Promise.all([loadAdvice(client, scope.scope), loadDecisions(client, scope.scope)]);
    return NextResponse.json(applyDecisions(advice, decisions));
  } catch {
    return NextResponse.json({ error: "建議暫時讀不到，請重試" }, { status: 500 });
  }
}

/** 採用／略過一個建議。只記錄，不會改任何設定。 */
export async function POST(request: NextRequest) {
  const denied = await requirePermission(request, "campaigns:write");
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { suggestionId?: string; decision?: string } | null;
  const suggestionId = body?.suggestionId;
  if (typeof suggestionId !== "string" || (body?.decision !== "adopted" && body?.decision !== "skipped")) {
    return NextResponse.json({ error: "資料格式不正確" }, { status: 400 });
  }
  const branchId = suggestionId.split(":")[1];
  const ctx = await getAdminContext(request);
  const scope = resolveBranchScope(ctx, branchId);
  if (!branchId || !scope.ok) return NextResponse.json({ error: "Forbidden branch" }, { status: 403 });
  if (!isAdminConfigured()) return NextResponse.json({ error: "後端未設定" }, { status: 503 });

  try {
    const client = db();
    const advice = await loadAdvice(client, scope.scope);
    const found = advice.enough ? [...advice.top, ...advice.more].find((s) => s.id === suggestionId) : undefined;
    if (!found) return NextResponse.json({ error: "這個建議已經不存在，請重新整理" }, { status: 404 });
    const { error } = await client.from("advice_decisions").upsert({
      suggestion_id: suggestionId,
      branch_id: branchId,
      decision: body.decision,
      decided_at: new Date().toISOString(),
      decided_by: ctx.user_id ?? null,
      snapshot: { title: found.title, numbers: found.numbers, impactNt: found.impactNt },
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "沒有記錄成功，請重試" }, { status: 500 });
  }
}
