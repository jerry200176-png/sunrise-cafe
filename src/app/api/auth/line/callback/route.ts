import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const bookingCode = request.nextUrl.searchParams.get("state");
  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/line/callback`;

  const errorDest = bookingCode
    ? `${origin}/book/success?code=${bookingCode}&line_error=1`
    : `${origin}/book?line_error=1`;

  if (!code) return NextResponse.redirect(errorDest);

  try {
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINE_LOGIN_CHANNEL_ID ?? "",
        client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET ?? "",
      }),
    });

    if (!tokenRes.ok) return NextResponse.redirect(errorDest);

    const { access_token } = await tokenRes.json() as { access_token: string };

    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!profileRes.ok) return NextResponse.redirect(errorDest);

    const { userId } = await profileRes.json() as { userId: string };

    if (bookingCode) {
      const db = supabaseAdmin();
      const { data: reservation } = await db
        .from("reservations")
        .select("phone")
        .eq("booking_code", bookingCode)
        .single();

      if (reservation?.phone) {
        await db
          .from("reservations")
          .update({ line_user_id: userId })
          .eq("phone", reservation.phone)
          .neq("status", "cancelled");
      }

      return NextResponse.redirect(`${origin}/book/success?code=${bookingCode}&line_bound=1`);
    }

    return NextResponse.redirect(`${origin}/book?line_user_id=${encodeURIComponent(userId)}`);
  } catch {
    return NextResponse.redirect(errorDest);
  }
}
