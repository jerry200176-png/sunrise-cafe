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

  const { data, error } = await adminClient()
    .from("tables")
    .select("*")
    .eq("branch_id", branchId)
    .order("number");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { branch_id, number } = body as { branch_id: string; number: string };

  if (!branch_id || !number?.trim()) {
    return NextResponse.json({ error: "缺少 branch_id 或桌號" }, { status: 400 });
  }

  const { data, error } = await adminClient()
    .from("tables")
    .insert({ branch_id, number: number.trim() })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
