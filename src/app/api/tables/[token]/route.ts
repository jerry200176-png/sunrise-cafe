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
    .select("id, number, is_active, branch_id, branches(name)")
    .eq("qr_token", token)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "找不到此桌位" }, { status: 404 });
  }

  if (!data.is_active) {
    return NextResponse.json({ error: "此桌位目前停用" }, { status: 403 });
  }

  return NextResponse.json(data);
}
