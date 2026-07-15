import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminContext, requirePermission } from "@/lib/admin-api-auth";
import { isAdminConfigured } from "@/lib/supabase-admin";
import { filterBranchIds } from "@/lib/rbac";
import { phonesMatch, normalizePhone } from "@/lib/phone-utils";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type WaitlistRow = {
  id: string;
  customer_name: string;
  phone: string;
  start_time: string;
  end_time: string;
  status: string;
  created_at: string;
  notified_at: string | null;
  room: { name: string; branch_id: string; branch: { name: string } | { name: string }[] } | { name: string; branch_id: string; branch: { name: string } | { name: string }[] }[];
};

function normalizeRow(row: WaitlistRow) {
  const room = Array.isArray(row.room) ? row.room[0] : row.room;
  const branch = Array.isArray(room?.branch) ? room.branch[0] : room?.branch;
  return {
    id: row.id,
    customer_name: row.customer_name,
    phone: row.phone,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    created_at: row.created_at,
    notified_at: row.notified_at,
    room_name: room?.name ?? "",
    branch_id: room?.branch_id ?? "",
    branch_name: branch?.name ?? "",
  };
}

/** Expand common TW phone formats for `.in()` lookup. */
function phoneLookupVariants(phone: string): string[] {
  const raw = phone.trim();
  const digits = normalizePhone(raw);
  const variants = new Set<string>([raw, digits].filter(Boolean));
  if (digits.startsWith("09") && digits.length === 10) {
    variants.add(`+886${digits.slice(1)}`);
    variants.add(`886${digits.slice(1)}`);
  }
  return [...variants];
}

/** Phones that have ever bound LINE (any reservation with line_user_id). */
async function phonesWithLine(phones: string[]): Promise<Set<string>> {
  const unique = [...new Set(phones.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) return new Set();

  const lookup = [...new Set(unique.flatMap(phoneLookupVariants))];
  const { data, error } = await db()
    .from("reservations")
    .select("phone")
    .not("line_user_id", "is", null)
    .in("phone", lookup)
    .limit(500);

  if (error) {
    console.warn("[admin/waitlist] has_line lookup failed:", error.message);
    return new Set();
  }

  const bound = new Set<string>();
  for (const row of data ?? []) {
    const stored = (row as { phone: string }).phone;
    for (const candidate of unique) {
      if (phonesMatch(stored, candidate)) {
        bound.add(normalizePhone(candidate) || candidate);
      }
    }
  }
  return bound;
}

/** GET: 等位清單（等候中 + 已通知） */
export async function GET(request: NextRequest) {
  const denied = await requirePermission(request, "reservations:read");
  if (denied) return denied;

  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  const ctx = await getAdminContext(request);
  const statusFilter = request.nextUrl.searchParams.get("status");

  try {
    let query = db()
      .from("waitlist")
      .select(
        "id, customer_name, phone, start_time, end_time, status, created_at, notified_at, room:rooms(name, branch_id, branch:branches(name))"
      );

    if (statusFilter === "waiting" || statusFilter === "notified") {
      query = query.eq("status", statusFilter);
    } else {
      query = query.in("status", ["waiting", "notified"]);
    }

    const { data, error } = await query.order("created_at", { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as WaitlistRow[];
    const branchIds = [...new Set(rows.map((r) => normalizeRow(r).branch_id).filter(Boolean))];
    const allowed = new Set(filterBranchIds(ctx, branchIds));

    const base = rows
      .map(normalizeRow)
      .filter((r) => !r.branch_id || allowed.has(r.branch_id));

    const linePhones = await phonesWithLine(base.map((r) => r.phone));
    const items = base.map((r) => {
      const key = normalizePhone(r.phone) || r.phone;
      const has_line = linePhones.has(key);
      return {
        ...r,
        has_line,
        needs_call: r.status === "waiting" && !has_line,
      };
    });

    items.sort((a, b) => {
      if (a.needs_call !== b.needs_call) return a.needs_call ? -1 : 1;
      return a.created_at.localeCompare(b.created_at);
    });

    return NextResponse.json({
      items,
      total: items.length,
      needs_call_count: items.filter((i) => i.needs_call).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入等位清單";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
