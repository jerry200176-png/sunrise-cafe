import { NextRequest, NextResponse } from "next/server";
import { updateRoom, deleteRoom } from "@/lib/supabase-fetch";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  try {
    const body = await request.json();
    const { name, type, capacity, price_weekday, price_weekend } = body as Partial<{
      name: string;
      type: string | null;
      capacity: number;
      price_weekday: number;
      price_weekend: number;
    }>;
    const patch: Parameters<typeof updateRoom>[1] = {};
    if (name !== undefined) patch.name = name;
    if (type !== undefined) patch.type = type;
    if (capacity !== undefined) patch.capacity = Number(capacity);
    if (price_weekday !== undefined) patch.price_weekday = Number(price_weekday);
    if (price_weekend !== undefined) patch.price_weekend = Number(price_weekend);
    await updateRoom(id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法更新包廂";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  try {
    await deleteRoom(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法刪除包廂";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
