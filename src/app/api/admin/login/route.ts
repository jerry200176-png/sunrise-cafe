import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSessionSecret } from "@/lib/admin-auth";
import {
  ADMIN_SESSION_COOKIE,
  createSignedAdminSession,
} from "@/lib/admin-api-auth";
import { verifyAdminPassword } from "@/lib/admin-password";
import {
  findAdminUserByEmail,
  getAdminUserBranchIds,
  isAdminUsersTableReady,
} from "@/lib/admin-users";
import type { AdminRole } from "@/lib/rbac";

const MAX_AGE = 86400;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf-8");
  const bb = Buffer.from(b, "utf-8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json(
      { ok: false, error: "後台未設定登入密碼" },
      { status: 503 }
    );
  }

  let body: { password?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "請提供密碼" },
      { status: 400 }
    );
  }

  const password = body.password;
  if (typeof password !== "string") {
    return NextResponse.json(
      { ok: false, error: "請提供密碼" },
      { status: 400 }
    );
  }

  const signingKey = getSessionSecret() ?? adminPassword;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  let sessionClaims: {
    sub?: string;
    role: AdminRole;
    branch_ids?: string[] | null;
    legacy?: boolean;
    email?: string;
    display_name?: string;
  } | null = null;

  if (email && (await isAdminUsersTableReady())) {
    const user = await findAdminUserByEmail(email);
    if (!user || !user.is_active) {
      return NextResponse.json(
        { ok: false, error: "帳號或密碼錯誤" },
        { status: 401 }
      );
    }
    const ok = await verifyAdminPassword(password, user.password_hash as string);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "帳號或密碼錯誤" },
        { status: 401 }
      );
    }
    const role = user.role as AdminRole;
    const branch_ids = await getAdminUserBranchIds(user.id as string, role);
    sessionClaims = {
      sub: user.id as string,
      role,
      branch_ids,
      email: user.email as string,
      display_name: user.display_name as string,
    };
  } else if (!email && safeEqual(password, adminPassword)) {
    sessionClaims = {
      role: "owner",
      branch_ids: null,
      legacy: true,
    };
  } else {
    return NextResponse.json(
      { ok: false, error: "密碼錯誤" },
      { status: 401 }
    );
  }

  const value = await createSignedAdminSession(signingKey, MAX_AGE, sessionClaims);
  const isProd = process.env.NODE_ENV === "production";
  const res = NextResponse.json({
    ok: true,
    role: sessionClaims.role,
    email: sessionClaims.email ?? null,
  });
  res.cookies.set(ADMIN_SESSION_COOKIE, value, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: MAX_AGE,
    secure: isProd,
  });
  return res;
}
