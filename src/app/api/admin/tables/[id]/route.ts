import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/admin-api-auth";

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (value: JsonObject, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

/** Preserve table identity, branch and QR token while editing its label or active state. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requirePermission(request, "orders:write");
  if (denied) return denied;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "桌位識別碼格式不正確" }, { status: 400 });
  }

  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const scope = await db.from("tables").select("branch_id").eq("id", id).maybeSingle();
    if (scope.error) return NextResponse.json({ error: "無法讀取桌位，請稍後再試" }, { status: 500 });
    if (!scope.data || typeof scope.data.branch_id !== "string" || !scope.data.branch_id) {
      return NextResponse.json({ error: "找不到此桌位" }, { status: 404 });
    }
    const branchId = scope.data.branch_id;
    const branchDenied = await requirePermission(request, "orders:write", branchId);
    if (branchDenied) {
      return branchDenied.status === 403
        ? NextResponse.json({ error: "找不到此桌位" }, { status: 404 })
        : branchDenied;
    }

    const body: unknown = await request.json().catch(() => null);
    if (!isObject(body) || !onlyKeys(body, ["number", "is_active", "expected"]) ||
        !isObject(body.expected) || !onlyKeys(body.expected, ["number", "is_active"]) ||
        typeof body.expected.number !== "string" || typeof body.expected.is_active !== "boolean") {
      return NextResponse.json({ error: "資料格式不正確，請重新整理後再試" }, { status: 400 });
    }

    const changes: { number?: string; is_active?: boolean } = {};
    if ("number" in body) {
      if (typeof body.number !== "string" || !body.number.trim() || body.number.trim().length > 40 ||
          /[\u0000-\u001f\u007f]/.test(body.number)) {
        return NextResponse.json({ error: "桌號需為 1 至 40 個字元，且不可包含換行或控制字元" }, { status: 400 });
      }
      changes.number = body.number.trim();
    }
    if ("is_active" in body) {
      if (typeof body.is_active !== "boolean") {
        return NextResponse.json({ error: "桌位狀態格式不正確" }, { status: 400 });
      }
      changes.is_active = body.is_active;
    }
    if (!Object.keys(changes).length ||
        (changes.number === undefined || changes.number === body.expected.number) &&
        (changes.is_active === undefined || changes.is_active === body.expected.is_active)) {
      return NextResponse.json({ error: "沒有需要更新的資料" }, { status: 400 });
    }

    const result = await db.from("tables")
      .update(changes)
      .eq("id", id)
      .eq("branch_id", branchId)
      .eq("number", body.expected.number)
      .eq("is_active", body.expected.is_active)
      .select("id,number,is_active")
      .maybeSingle();
    if (result.error) return NextResponse.json({ error: "無法更新桌位，請稍後再試" }, { status: 500 });
    if (!result.data) return NextResponse.json({ error: "桌位資料已變更，請重新整理後再試" }, { status: 409 });
    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json({ error: "無法更新桌位，請稍後再試" }, { status: 500 });
  }
}
