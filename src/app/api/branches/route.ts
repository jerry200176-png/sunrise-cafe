import { NextRequest, NextResponse } from "next/server";
import { fetchBranches, fetchPublicBranches, insertBranch } from "@/lib/supabase-fetch";
import { getAdminContext, hasValidAdminSession, requirePermission } from "@/lib/admin-api-auth";
import { roleHasPermission } from "@/lib/rbac";
import type { RentalNoteSection } from "@/types";
import { validateWeeklyHours, type WeeklyHours } from "@/lib/branch-hours";

export async function GET(request: NextRequest) {
  try {
    const isAdmin = await hasValidAdminSession(request);
    if (!isAdmin) return NextResponse.json((await fetchPublicBranches()) ?? []);

    const context = await getAdminContext(request);
    if (context.role === "owner") {
      // Owner edits round-trip internal LINE/payment fields, including archived branches.
      const includeArchived = request.nextUrl.searchParams.get("include") === "archived";
      return NextResponse.json((await fetchBranches(includeArchived)) ?? []);
    }

    // Limit both branch visibility and fields for non-owner sessions. Payment details
    // are needed by the existing staff/manager reservation-message workflow.
    const allowedIds = new Set(context.branch_ids ?? []);
    if (!allowedIds.size) return NextResponse.json([]);
    const rows = await fetchBranches(false);
    const publicKeys = ["id", "name", "address", "phone", "open_time", "close_time", "closed_dates", "display_name", "rental_notes", "deposit_info", "weekly_hours"];
    const keys = roleHasPermission(context.role, "reservations:message_send")
      ? [...publicKeys, "payment_info", "line_pay_url"] : publicKeys;
    const scoped = (Array.isArray(rows) ? rows : [])
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && typeof (row as Record<string, unknown>).id === "string" && allowedIds.has((row as Record<string, string>).id))
      .map((row) => Object.fromEntries(keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]])));
    return NextResponse.json(scoped);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入分店";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requirePermission(request, "branches:write");
  if (denied) return denied;

  try {
    const body = await request.json();
    const { name, address, phone, open_time, close_time, line_group_id, display_name, payment_info, line_pay_url, rental_notes, deposit_info, google_review_url, weekly_hours } = body as {
      name: string;
      address?: string | null;
      phone?: string | null;
      open_time?: string | null;
      close_time?: string | null;
      line_group_id?: string | null;
      display_name?: string | null;
      payment_info?: string | null;
      line_pay_url?: string | null;
      rental_notes?: RentalNoteSection[] | null;
      deposit_info?: string | null;
      google_review_url?: string | null;
      weekly_hours?: WeeklyHours | null;
    };
    if (!name?.trim()) {
      return NextResponse.json({ error: "名稱為必填" }, { status: 400 });
    }
    const hoursError = validateWeeklyHours(weekly_hours);
    if (hoursError) return NextResponse.json({ error: hoursError }, { status: 400 });
    await insertBranch({ name: name.trim(), address: address ?? null, phone: phone ?? null, open_time: open_time ?? null, close_time: close_time ?? null, line_group_id: line_group_id ?? null, display_name: display_name ?? null, payment_info: payment_info ?? null, line_pay_url: line_pay_url ?? null, rental_notes: rental_notes ?? null, deposit_info: deposit_info ?? null, google_review_url: google_review_url ?? null, weekly_hours: weekly_hours ?? null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法新增分店";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
