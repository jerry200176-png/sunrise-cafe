import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const branchId = form.get("branch_id");
  const photo = form.get("photo");
  if (typeof branchId !== "string" || !(photo instanceof File)) {
    return NextResponse.json({ error: "缺少分店或照片" }, { status: 400 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId)) {
    return NextResponse.json({ error: "分店格式不正確" }, { status: 400 });
  }
  const denied = await requirePermission(request, "orders:write", branchId);
  if (denied) return denied;
  const ext = TYPES[photo.type];
  if (!ext || photo.size <= 0 || photo.size > MAX_BYTES) {
    return NextResponse.json({ error: "請上傳 5 MB 以下的 JPG、PNG 或 WebP 照片" }, { status: 400 });
  }
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const matches = photo.type === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : photo.type === "image/png" ? bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
    : bytes.slice(0, 4).join(",") === "82,73,70,70" && bytes.slice(8, 12).join(",") === "87,69,66,80";
  if (!matches) return NextResponse.json({ error: "照片內容與格式不符" }, { status: 400 });
  const path = `${branchId}/${crypto.randomUUID()}.${ext}`;
  const db = supabaseAdmin();
  const bucket = await db.storage.getBucket("menu-photos");
  if (bucket.error) {
    const created = await db.storage.createBucket("menu-photos", {
      public: true, fileSizeLimit: MAX_BYTES, allowedMimeTypes: Object.keys(TYPES),
    });
    if (created.error && (await db.storage.getBucket("menu-photos")).error) {
      return NextResponse.json({ error: "照片儲存空間尚未就緒" }, { status: 503 });
    }
  } else if (!bucket.data.public) {
    return NextResponse.json({ error: "照片儲存空間尚未開放公開讀取" }, { status: 503 });
  }
  const result = await db.storage.from("menu-photos").upload(path, bytes, {
    contentType: photo.type, upsert: false, cacheControl: "3600",
  });
  if (result.error) return NextResponse.json({ error: "照片上傳失敗" }, { status: 500 });
  return NextResponse.json({ url: db.storage.from("menu-photos").getPublicUrl(path).data.publicUrl });
}
