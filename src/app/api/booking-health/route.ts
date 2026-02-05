import { NextResponse } from "next/server";
import {
  isAdminConfigured,
  fetchBranch,
  getBlockedSlots,
} from "@/lib/supabase-admin";

/**
 * 訂位後端健康檢查：確認 Vercel 上 SUPABASE_SERVICE_ROLE_KEY 與 get_blocked_slots 是否正常。
 * 線上站點可開啟：https://你的網址/api/booking-health
 */
export async function GET() {
  const serviceRoleOk = isAdminConfigured();
  if (!serviceRoleOk) {
    return NextResponse.json(
      {
        ok: false,
        message: "訂位功能無法使用：未設定 SUPABASE_SERVICE_ROLE_KEY",
        serviceRoleConfigured: false,
        hint: "請在 Vercel 專案 → Settings → Environment Variables 新增 SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 503 }
    );
  }

  try {
    const branchesRes = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")}/rest/v1/branches?select=id&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );
    if (!branchesRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: "無法讀取分店資料",
          serviceRoleConfigured: true,
          status: branchesRes.status,
          body: (await branchesRes.text()).slice(0, 300),
        },
        { status: 503 }
      );
    }
    const branches = (await branchesRes.json()) as { id: string }[];
    const branchId = Array.isArray(branches) && branches[0] ? branches[0].id : null;

    if (branchId) {
      await fetchBranch(branchId);
      const today = new Date().toISOString().slice(0, 10);
      await getBlockedSlots(branchId, today);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        message: "後端連線或 RPC 錯誤",
        serviceRoleConfigured: true,
        error: message,
        hint:
          message.includes("get_blocked_slots") || message.includes("rpc")
            ? "請在 Supabase SQL Editor 執行 supabase/migration-get-blocked-slots.sql 建立 get_blocked_slots 函式"
            : "請檢查 Vercel 環境變數與 Supabase 專案是否正常",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "訂位後端正常（Service Role 與 get_blocked_slots 可用）",
    serviceRoleConfigured: true,
  });
}
