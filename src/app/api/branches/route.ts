import { NextRequest, NextResponse } from "next/server";
import { fetchBranches, fetchPublicBranches, insertBranch } from "@/lib/supabase-fetch";
import { hasValidAdminSession, requireAdminApiAuth } from "@/lib/admin-api-auth";
import type { RentalNoteSection } from "@/types";

export async function GET(request: NextRequest) {
  try {
    // The admin branch editor round-trips LINE group / payment fields; guests only get the public subset.
    const data = (await hasValidAdminSession(request)) ? await fetchBranches() : await fetchPublicBranches();
    return NextResponse.json(data ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法載入分店";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminApiAuth(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const { name, address, phone, open_time, close_time, line_group_id, display_name, payment_info, line_pay_url, rental_notes, deposit_info, google_review_url } = body as {
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
    };
    if (!name?.trim()) {
      return NextResponse.json({ error: "名稱為必填" }, { status: 400 });
    }
    await insertBranch({ name: name.trim(), address: address ?? null, phone: phone ?? null, open_time: open_time ?? null, close_time: close_time ?? null, line_group_id: line_group_id ?? null, display_name: display_name ?? null, payment_info: payment_info ?? null, line_pay_url: line_pay_url ?? null, rental_notes: rental_notes ?? null, deposit_info: deposit_info ?? null, google_review_url: google_review_url ?? null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "無法新增分店";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
