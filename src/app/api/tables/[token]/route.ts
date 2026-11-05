import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "缺少桌位 token" }, { status: 400 });
  }

  const { data, error } = await adminClient()
    .from("tables")
    .select("id, number, is_active, branch_id, branches(name,archived_at)")
    .eq("qr_token", token)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "找不到此桌位" }, { status: 404 });
  }

  if (!data.is_active) {
    return NextResponse.json({ error: "此桌位目前停用" }, { status: 403 });
  }

  const branch = Array.isArray(data.branches) ? data.branches[0] : data.branches;
  if (!branch || !("archived_at" in branch)) return NextResponse.json({ error: "目前無法確認分店狀態" }, { status: 503 });
  if (branch.archived_at !== null) return NextResponse.json({ error: "此分店目前無法點餐" }, { status: 403 });

  return NextResponse.json({ ...data, branches: { name: branch.name } });
}
