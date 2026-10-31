import { NextRequest, NextResponse } from "next/server";
import { updateBranch, setBranchArchived } from "@/lib/supabase-fetch";
import { requirePermission } from "@/lib/admin-api-auth";
import type { RentalNoteSection } from "@/types";
import { validateWeeklyHours, type WeeklyHours } from "@/lib/branch-hours";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const denied = await requirePermission(request, "branches:write", id);
  if (denied) return denied;

  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  try {
    const body = await request.json();
    const { name, address, phone, open_time, close_time, line_group_id, display_name, payment_info, line_pay_url, closed_dates, rental_notes, deposit_info, google_review_url, weekly_hours, archived } = body as Partial<{
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
      rental_notes: RentalNoteSection[] | null;
      deposit_info: string | null;
      google_review_url: string | null;
      weekly_hours: WeeklyHours | null;
      archived: boolean;
    }>;
    const hoursError = validateWeeklyHours(weekly_hours);
    if (hoursError) return NextResponse.json({ error: hoursError }, { status: 400 });
    if (typeof archived === "boolean") {
      await setBranchArchived(id, archived);
      return NextResponse.json({ ok: true });
    }
    await updateBranch(id, { name, address, phone, open_time, close_time, line_group_id, display_name, payment_info, line_pay_url, closed_dates, rental_notes, deposit_info, google_review_url, weekly_hours });
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
    // 不再真的刪除：封存。底下的包廂、訂位、訂單全部保留，可從「已封存」還原。
    await setBranchArchived(id, true);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法封存分店";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
