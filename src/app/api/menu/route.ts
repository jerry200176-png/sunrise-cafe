import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const branchId = request.nextUrl.searchParams.get("branchId");
  if (!branchId) {
    return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  }

  const db = adminClient();

  const [catResult, itemResult] = await Promise.all([
    db
      .from("menu_categories")
      .select("*")
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .order("display_order"),
    db
      .from("menu_items")
      .select("*, options:menu_item_options(*)")
      .eq("branch_id", branchId)
      .order("display_order"),
  ]);

  if (catResult.error) {
    return NextResponse.json({ error: catResult.error.message }, { status: 500 });
  }
  if (itemResult.error) {
    return NextResponse.json({ error: itemResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    categories: catResult.data ?? [],
    items: itemResult.data ?? [],
  });
}
