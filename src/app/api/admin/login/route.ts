import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSessionSecret } from "@/lib/admin-auth";

const COOKIE_NAME = "admin_session";
const MAX_AGE = 86400; // 24 hours

/** 常數時間字串比對，避免密碼比對的 timing side-channel */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf-8");
  const bb = Buffer.from(b, "utf-8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function createSignedSession(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + MAX_AGE };
  const payloadStr = JSON.stringify(payload);
  const encoded = Buffer.from(payloadStr, "utf-8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

export async function POST(request: NextRequest) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "後台未設定登入密碼" },
      { status: 503 }
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "請提供密碼" },
      { status: 400 }
    );
  }

  const password = body.password;
  if (typeof password !== "string" || !safeEqual(password, secret)) {
    return NextResponse.json(
      { ok: false, error: "密碼錯誤" },
      { status: 401 }
    );
  }

  // 簽章使用 SESSION_SECRET（未設定時向下相容沿用密碼）
  const value = createSignedSession(getSessionSecret() ?? secret);
  const isProd = process.env.NODE_ENV === "production";
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, value, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: MAX_AGE,
    secure: isProd,
  });
  return res;
}
