import { NextResponse } from "next/server";

/**
 * 診斷：從伺服器連到 Supabase 是否成功，並回傳詳細錯誤。
 * 瀏覽器開 http://localhost:3000/api/diagnose 即可查看。
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key) {
    return NextResponse.json({
      ok: false,
      error: "缺少環境變數",
      env: { hasUrl: !!url, hasKey: !!key, urlLength: url?.length ?? 0, keyPrefix: key?.slice(0, 20) + "..." },
    }, { status: 500 });
  }

  const baseUrl = url.replace(/\/$/, "");
  const target = `${baseUrl}/rest/v1/branches?select=id&limit=1`;

  try {
    const res = await fetch(target, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    if (res.ok) {
      return NextResponse.json({
        ok: true,
        message: "可連線至 Supabase",
        status: res.status,
      });
    }
    return NextResponse.json({
      ok: false,
      error: "Supabase 回傳錯誤",
      status: res.status,
      body: text.slice(0, 500),
    }, { status: 500 });
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err));
    const cause = (e as Error & { cause?: { code?: string; errno?: number } }).cause;
    return NextResponse.json({
      ok: false,
      error: e.message,
      code: cause?.code ?? (e as Error & { code?: string }).code,
      errno: cause?.errno,
      hint:
        cause?.code === "ENOTFOUND"
          ? "無法解析網域，請檢查 NEXT_PUBLIC_SUPABASE_URL 是否正確。"
          : cause?.code === "ECONNREFUSED"
            ? "連線被拒絕，請確認 Supabase 專案未暫停、URL 正確。"
            : cause?.code === "ETIMEDOUT" || cause?.code === "TIMEOUT"
              ? "連線逾時，可能是網路或防火牆阻擋對 Supabase 的連線。"
              : "請檢查網路、VPN、防火牆，或改用手機熱點測試。",
    }, { status: 500 });
  }
}
