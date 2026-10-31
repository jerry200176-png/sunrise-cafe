import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePermission } from "@/lib/admin-api-auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
type Cursor = { t: string | null; id: string; branch: string; status: string | null; scope: string | null; since: string | null };
type Row = { id: string; created_at: string | null; [key: string]: unknown };

function decodeCursor(value: string, branch: string, status: string | null, scope: string | null, since: string | null): Cursor | null {
  try {
    if (value.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const c = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (typeof c.id !== "string" || !UUID.test(c.id) || c.branch !== branch || c.status !== status || c.scope !== scope || c.since !== since) return null;
    if (c.t !== null && (typeof c.t !== "string" || !TIME.test(c.t) || Number.isNaN(Date.parse(c.t)))) return null;
    return c;
  } catch { return null; }
}

function encodeCursor(row: Row, branch: string, status: string | null, scope: string | null, since: string | null): string {
  return Buffer.from(JSON.stringify({ t: row.created_at, id: row.id, branch, status, scope, since })).toString("base64url");
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const branchId = search.get("branchId");
  const status = search.get("status");
  const scope = search.get("scope");
  const since = search.get("since");
  if (!branchId) return NextResponse.json({ error: "缺少 branchId" }, { status: 400 });
  const denied = await requirePermission(request, "orders:read", branchId);
  if (denied) return denied;
  if ((scope !== null && !["active", "printable"].includes(scope)) || (scope !== null && status !== null) ||
      (scope === "printable" ? !since || !TIME.test(since) || Number.isNaN(Date.parse(since)) : since !== null)) {
    return NextResponse.json({ error: "訂單範圍不正確" }, { status: 400 });
  }

  const paged = search.has("limit") || search.has("cursor");
  const limitText = search.get("limit") ?? String(PAGE_SIZE);
  if (!/^\d{1,3}$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > PAGE_SIZE) {
    return NextResponse.json({ error: "每頁筆數須介於 1 到 100" }, { status: 400 });
  }
  const limit = Number(limitText);
  const cursorText = search.get("cursor");
  let cursor = cursorText === null ? null : decodeCursor(cursorText, branchId, status, scope, since);
  if (cursorText !== null && !cursor) return NextResponse.json({ error: "訂單游標不正確，請重新整理" }, { status: 400 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const accumulated: Row[] = [];

  for (let page = 0; page < (paged ? 1 : MAX_PAGES); page++) {
    let query = db.from("orders").select("*, table:tables(number), order_items(*)", { count: "exact" })
      .eq("branch_id", branchId).order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false }).limit(limit + 1);
    if (status) query = query.eq("status", status);
    if (scope === "active" || scope === "printable") query = query.in("status", ["pending", "preparing", "ready"]);
    if (scope === "printable" && since) query = query.eq("is_printed", false).gte("created_at", since);
    if (cursor?.t === null) query = query.is("created_at", null).lt("id", cursor.id);
    else if (cursor) query = query.or(`created_at.lt."${cursor.t}",and(created_at.eq."${cursor.t}",id.lt.${cursor.id}),created_at.is.null`);
    const { data, error, count } = await query;
    if (error || !Array.isArray(data) || count === null || data.length !== Math.min(count, limit + 1)) {
      return NextResponse.json({ error: "無法載入完整訂單，請重試" }, { status: 503 });
    }
    const rows = data as Row[];
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const nextCursor = rows.length > limit && last ? encodeCursor(last, branchId, status, scope, since) : null;
    if (nextCursor && !decodeCursor(nextCursor, branchId, status, scope, since)) return NextResponse.json({ error: "訂單資料無法分頁，請聯絡管理者" }, { status: 503 });
    if (paged) return NextResponse.json({ items, nextCursor });
    accumulated.push(...items);
    if (!nextCursor) return NextResponse.json(accumulated);
    cursor = decodeCursor(nextCursor, branchId, status, scope, since);
  }
  return NextResponse.json({ error: "訂單太多，請更新後台以分頁查看" }, { status: 503 });
}
