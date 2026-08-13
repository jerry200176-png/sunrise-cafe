import { NextRequest, NextResponse } from "next/server";
import { LINE_SITE_URL } from "@/lib/line-flex";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  if (orderId) {
    await supabaseAdmin()
      .from("line_pay_payments")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("order_id", orderId)
      .eq("status", "pending");
  }
  const url = new URL(`${LINE_SITE_URL}/book/query`);
  url.searchParams.set("linepay", "cancelled");
  return NextResponse.redirect(url);
}
