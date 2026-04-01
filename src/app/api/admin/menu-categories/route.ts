import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { branch_id, name, display_order } = body as {
    branch_id: string;
    name: string;
    display_order?: number;
  };

  if (!branch_id || !name?.trim()) {
    return NextResponse.json({ error: "缺少 branch_id 或分類名稱" }, { status: 400 });
  }

  const { data, error } = await adminClient()
    .from("menu_categories")
    .insert({ branch_id, name: name.trim(), display_order: display_order ?? 0 })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
