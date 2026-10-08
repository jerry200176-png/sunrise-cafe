import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/admin-api-auth";
import { loadOptionSets, saveOptionSet } from "@/lib/option-sets-db";
import { friendlyMessage } from "@/lib/friendly-error";

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  if (!branchId) return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  const denied = await requirePermission(request, "orders:read", branchId);
  if (denied) return denied;
  try {
    return NextResponse.json(await loadOptionSets(db(), branchId));
  } catch (err) {
    return NextResponse.json({ error: friendlyMessage(err instanceof Error ? err.message : null, 500) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ({ branch_id?: string } & Record<string, unknown>) | null;
  const branchId = body?.branch_id;
  if (typeof branchId !== "string") return NextResponse.json({ error: "缺少 branch_id" }, { status: 400 });
  const denied = await requirePermission(request, "orders:write", branchId);
  if (denied) return denied;
  try {
    const id = await saveOptionSet(db(), branchId, null, body);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "無法建立選項組" }, { status: 400 });
  }
}
