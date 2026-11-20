import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAuth } from "@/lib/admin-api-auth";
import { branchCustomerBots } from "@/lib/customer-line-bots";
import { publishRichMenu, removeRichMenu } from "@/lib/line-richmenu";

const USER_ID = /^U[0-9a-f]{32}$/;

/**
 * 發布／移除 LINE 底部選單。只有後台登入可用。
 * body: { action: "publish" | "remove", userId?: 只給這位 LINE 使用者（試用）, branchId?: 分店自己的客人帳號 }
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { action?: string; userId?: string; branchId?: string } | null;
  const action = body?.action;
  if (action !== "publish" && action !== "remove") return NextResponse.json({ error: "action 必須是 publish 或 remove" }, { status: 400 });
  if (body?.userId !== undefined && !USER_ID.test(body.userId)) return NextResponse.json({ error: "userId 格式不正確" }, { status: 400 });

  // A named branch must have its own account; never fall back to another store's guests.
  const token = body?.branchId
    ? branchCustomerBots().find((b) => b.branchId === body.branchId)?.token
    : process.env.LINE_CUSTOMER_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "找不到這個客人帳號的 token" }, { status: 400 });

  try {
    const richMenuId = action === "publish" ? await publishRichMenu(token, body?.userId) : (await removeRichMenu(token, body?.userId), null);
    console.info("[line-richmenu]", action, body?.userId ? "user" : "all", body?.branchId ?? "default");
    return NextResponse.json({ ok: true, action, scope: body?.userId ? "user" : "all", richMenuId });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "failed" }, { status: 502 });
  }
}
