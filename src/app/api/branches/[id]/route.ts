import { NextRequest, NextResponse } from "next/server";
import { updateBranch, deleteBranch } from "@/lib/supabase-fetch";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  try {
    const body = await request.json();
    const { name, address, phone, open_time, close_time } = body as Partial<{
      name: string;
      address: string | null;
      phone: string | null;
      open_time: string | null;
      close_time: string | null;
    }>;
    await updateBranch(id, { name, address, phone, open_time, close_time });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法更新分店";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  try {
    await deleteBranch(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法刪除分店";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
