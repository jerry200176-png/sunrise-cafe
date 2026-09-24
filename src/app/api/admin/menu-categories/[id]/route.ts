import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/admin-api-auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const db = supabaseAdmin();
  const found = await db.from("menu_categories").select("branch_id").eq("id", id).maybeSingle();
  if (found.error) return NextResponse.json({ error: found.error.message }, { status: 500 });
  if (!found.data) return NextResponse.json({ error: "找不到分類" }, { status: 404 });
  const denied = await requirePermission(request, "orders:write", found.data.branch_id);
  if (denied) return denied;
  const body = await request.json() as { name?: string; display_order?: number; is_active?: boolean };
  const changes: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (!body.name.trim()) return NextResponse.json({ error: "分類名稱不可為空" }, { status: 400 });
    changes.name = body.name.trim();
  }
  if (body.display_order !== undefined) changes.display_order = body.display_order;
  if (body.is_active !== undefined) changes.is_active = Boolean(body.is_active);
  if (!Object.keys(changes).length) return NextResponse.json({ error: "沒有變更" }, { status: 400 });
  const result = await db.from("menu_categories").update(changes).eq("id", id).eq("branch_id", found.data.branch_id);
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
