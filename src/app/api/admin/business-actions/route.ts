import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission, getAdminContext } from "@/lib/admin-api-auth";
import { hasPermission } from "@/lib/rbac";
import { isAdminConfigured } from "@/lib/supabase-admin";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "campaigns:read");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  const branchId = request.nextUrl.searchParams.get("branchId");
  const ctx = await getAdminContext(request);
  if (branchId && !hasPermission(ctx, "campaigns:read", branchId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    let q = supabaseAdmin()
      .from("business_actions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (branchId) q = q.eq("branch_id", branchId);

    const { data, error } = await q;
    if (error) {
      if (error.message.includes("business_actions")) {
        return NextResponse.json({ actions: [], migration_required: true });
      }
      throw error;
    }

    const actions = (data ?? []).filter((a) =>
      a.branch_id ? hasPermission(ctx, "campaigns:read", a.branch_id as string) : true
    );

    return NextResponse.json({ actions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入行動紀錄";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requirePermission(request, "campaigns:write");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const branch_id = body.branch_id ?? null;
    const ctx = await getAdminContext(request);
    if (branch_id && !hasPermission(ctx, "campaigns:write", branch_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const row = {
      branch_id,
      action_type: body.action_type ?? "ops_recommendation",
      title: String(body.title ?? "").trim(),
      description: body.description ?? null,
      status: body.status ?? "draft",
      target_metric: body.target_metric ?? null,
      baseline_value: body.baseline_value ?? null,
      metadata: body.metadata ?? {},
      created_by: ctx.user_id,
    };

    if (!row.title) {
      return NextResponse.json({ error: "title 為必填" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin()
      .from("business_actions")
      .insert(row)
      .select("id")
      .single();

    if (error) throw error;
    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法建立行動";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
