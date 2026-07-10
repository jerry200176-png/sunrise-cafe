import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionSecret } from "@/lib/admin-auth";
import {
  createLineBindCookieValue,
  setLineBindCookie,
  verifyLineOAuthState,
} from "@/lib/line-oauth";

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  const origin = request.nextUrl.origin;
  const secret = getSessionSecret();

  const fallbackBook = `${origin}/book?line_error=1`;
  const fallbackSuccess = (bookingCode: string) =>
    `${origin}/book/success?code=${bookingCode}&line_error=1`;

  if (!code || !stateParam || !secret) {
    return NextResponse.redirect(fallbackBook);
  }

  const state = await verifyLineOAuthState(stateParam, secret);
  if (!state) {
    return NextResponse.redirect(fallbackBook);
  }

  const bookingCode = state.booking_code;
  const errorDest =
    state.mode === "post_booking" && bookingCode
      ? fallbackSuccess(bookingCode)
      : fallbackBook;

  try {
    const redirectUri = `${origin}/api/auth/line/callback`;
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

    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!profileRes.ok) return NextResponse.redirect(errorDest);

    const { userId } = (await profileRes.json()) as { userId: string };
    if (!/^U[0-9a-f]{32}$/i.test(userId)) {
      return NextResponse.redirect(errorDest);
    }

    const bindValue = await createLineBindCookieValue(userId, secret);

    if (state.mode === "post_booking" && bookingCode) {
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

      const res = NextResponse.redirect(
        `${origin}/book/success?code=${bookingCode}&line_bound=1`
      );
      setLineBindCookie(res, bindValue);
      return res;
    }

    // prebooking: bind cookie only — no userId in URL (anti-forgery)
    const res = NextResponse.redirect(`${origin}/book?line_bound=1`);
    setLineBindCookie(res, bindValue);
    return res;
  } catch {
    return NextResponse.redirect(errorDest);
  }
}
