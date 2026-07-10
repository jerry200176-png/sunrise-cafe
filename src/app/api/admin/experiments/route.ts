import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { parseVariants } from "@/lib/experiments";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  try {
    const { data, error } = await supabaseAdmin()
      .from("experiments")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      if (error.message.includes("experiments")) {
        return NextResponse.json({ experiments: [], migration_required: true });
      }
      throw error;
    }

    const experiments = (data ?? []).map((row) => ({
      ...row,
      variants: parseVariants(row.variants),
    }));

    return NextResponse.json({ experiments });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入實驗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const key = String(body.key ?? "").trim();
    const name = String(body.name ?? "").trim();
    if (!key || !name) {
      return NextResponse.json({ error: "key 與 name 為必填" }, { status: 400 });
    }

    const row = {
      key,
      name,
      description: body.description ?? null,
      target_audience: body.target_audience ?? "all",
      status: body.status ?? "draft",
      variants: body.variants ?? ["control", "treatment"],
      start_at: body.start_at ?? null,
      end_at: body.end_at ?? null,
    };

    const { data, error } = await supabaseAdmin()
      .from("experiments")
      .insert(row)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ ok: true, experiment: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法建立實驗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
