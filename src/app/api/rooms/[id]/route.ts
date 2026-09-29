import { NextRequest, NextResponse } from "next/server";
import { updateRoom, deleteRoom } from "@/lib/supabase-fetch";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { roomPhotoUrlError } from "@/lib/room-photo";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  try {
    const body = await request.json();
    const { name, type, min_capacity, capacity, price_weekday, price_weekend, image_url } = body as Partial<{
      name: string;
      type: string | null;
      min_capacity: number;
      capacity: number;
      price_weekday: number;
      price_weekend: number;
      image_url: string | null;
    }>;
    const photoError = roomPhotoUrlError(image_url);
    if (photoError) return NextResponse.json({ error: photoError }, { status: 400 });
    const patch: Parameters<typeof updateRoom>[1] = {};
    if (name !== undefined) patch.name = name;
    if (type !== undefined) patch.type = type;
    if (min_capacity !== undefined) patch.min_capacity = Number(min_capacity);
    if (capacity !== undefined) patch.capacity = Number(capacity);
    if (price_weekday !== undefined) patch.price_weekday = Number(price_weekday);
    if (price_weekend !== undefined) patch.price_weekend = Number(price_weekend);
    if (image_url !== undefined) patch.image_url = image_url;
    await updateRoom(id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法更新包廂";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

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
