import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/admin-api-auth";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requirePermission(request, "orders:read");
  if (denied) return denied;
  const { id } = await params;

  const db = adminClient();
  const { data: scope, error: scopeError } = await db.from("tables")
    .select("branch_id").eq("id", id).maybeSingle();
  if (scopeError) return NextResponse.json({ error: "無法讀取桌位，請稍後再試" }, { status: 500 });
  if (!scope) return NextResponse.json({ error: "找不到此桌位" }, { status: 404 });
  if (typeof scope.branch_id !== "string" || !scope.branch_id) {
    return NextResponse.json({ error: "找不到此桌位" }, { status: 404 });
  }
  const branchDenied = await requirePermission(request, "orders:read", scope.branch_id);
  if (branchDenied) return branchDenied.status === 403 ? NextResponse.json({ error: "找不到此桌位" }, { status: 404 }) : branchDenied;

  const { data: table, error } = await db
    .from("tables")
    .select("qr_token, number")
    .eq("id", id)
    .eq("branch_id", scope.branch_id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "無法讀取桌位，請稍後再試" }, { status: 500 });
  if (!table) {
    return NextResponse.json({ error: "找不到此桌位" }, { status: 404 });
  }

  const baseUrl = request.nextUrl.origin;
  const orderUrl = `${baseUrl}/order/${table.qr_token}`;

  const dataUrl = await QRCode.toDataURL(orderUrl, {
    width: 300,
    margin: 2,
    color: { dark: "#1a1a1a", light: "#ffffff" },
  });

  return NextResponse.json({
    qr_data_url: dataUrl,
    order_url: orderUrl,
    table_number: table.number,
  });
}
