import { NextRequest, NextResponse } from "next/server";
import { updateBranch, deleteBranch } from "@/lib/supabase-fetch";
import { requirePermission } from "@/lib/admin-api-auth";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requirePermission(request, "branches:write", (await params).id);
  if (denied) return denied;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  try {
    const body = await request.json();
    const { name, address, phone, open_time, close_time, line_group_id, display_name, payment_info, line_pay_url, closed_dates, operational_config } = body as Partial<{
      name: string;
      address: string | null;
      phone: string | null;
      open_time: string | null;
      close_time: string | null;
      line_group_id: string | null;
      display_name: string | null;
      payment_info: string | null;
      line_pay_url: string | null;
      closed_dates: string[];
      operational_config: Record<string, unknown>;
    }>;
    await updateBranch(id, { name, address, phone, open_time, close_time, line_group_id, display_name, payment_info, line_pay_url, closed_dates, operational_config });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法更新分店";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const denied = await requirePermission(request, "branches:write", id);
  if (denied) return denied;

  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  try {
    await deleteBranch(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法刪除分店";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
