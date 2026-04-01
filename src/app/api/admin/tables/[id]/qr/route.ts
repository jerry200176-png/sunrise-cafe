import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: table, error } = await adminClient()
    .from("tables")
    .select("qr_token, number")
    .eq("id", id)
    .single();

  if (error || !table) {
    return NextResponse.json({ error: "找不到此桌位" }, { status: 404 });
  }

  const baseUrl = request.nextUrl.origin;
  const orderUrl = `${baseUrl}/order/${table.qr_token}`;

  const dataUrl = await QRCode.toDataURL(orderUrl, {
    width: 300,
    margin: 2,
    color: { dark: "#1a1a1a", light: "#ffffff" },
  });

  return NextResponse.json({
    qr_data_url: dataUrl,
    order_url: orderUrl,
    table_number: table.number,
  });
}
