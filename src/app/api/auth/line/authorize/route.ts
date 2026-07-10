import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret } from "@/lib/admin-auth";
import {
  buildLineAuthorizeUrl,
  createLineOAuthState,
  type LineOAuthMode,
} from "@/lib/line-oauth";

/**
 * Start LINE Login with HMAC-signed state (CSRF + replay protection).
 * GET /api/auth/line/authorize?mode=prebooking
 * GET /api/auth/line/authorize?mode=post_booking&code=ABC123
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID?.trim();
  const secret = getSessionSecret();
  if (!clientId || !secret) {
    return NextResponse.json({ error: "LINE Login not configured" }, { status: 503 });
  }

  const mode = request.nextUrl.searchParams.get("mode") as LineOAuthMode | null;
  const bookingCode = request.nextUrl.searchParams.get("code")?.trim().toUpperCase();

  if (mode !== "prebooking" && mode !== "post_booking") {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }
  if (mode === "post_booking" && (!bookingCode || !/^[A-Z0-9]{6}$/.test(bookingCode))) {
    return NextResponse.json({ error: "Invalid booking code" }, { status: 400 });
  }

  const signedState = await createLineOAuthState(
    {
      mode,
      booking_code: mode === "post_booking" ? bookingCode : undefined,
    },
    secret
  );

  const url = buildLineAuthorizeUrl(request.nextUrl.origin, clientId, signedState);
  return NextResponse.redirect(url);
}
