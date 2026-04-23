import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/book?line_error=1`);
  }

  try {
    const redirectUri = `${baseUrl}/api/auth/line/callback`;

    // 換取 access token
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

    if (!tokenRes.ok) {
      return NextResponse.redirect(`${baseUrl}/book?line_error=1`);
    }

    const { access_token } = await tokenRes.json() as { access_token: string };

    // 取得 LINE 用戶資料
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!profileRes.ok) {
      return NextResponse.redirect(`${baseUrl}/book?line_error=1`);
    }

    const { userId } = await profileRes.json() as { userId: string };

    return NextResponse.redirect(`${baseUrl}/book?line_user_id=${encodeURIComponent(userId)}`);
  } catch {
    return NextResponse.redirect(`${baseUrl}/book?line_error=1`);
  }
}
