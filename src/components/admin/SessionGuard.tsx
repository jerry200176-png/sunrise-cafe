"use client";

import { useEffect, useState } from "react";

/**
 * 後台登入 24 小時後會過期。過期後 API 回 401，各頁面以前會把它當成「沒有資料」，
 * 平板放一晚上就變成「目前沒有進行中的訂單」。這裡統一攔截 /api 的 401，
 * 在畫面最上方明確提示並給登入按鈕（所有後台頁面共用，不用逐頁處理）。
 */
export function SessionGuard() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      if (res.status === 401) {
        const raw = args[0];
        const url = typeof raw === "string" ? raw : raw instanceof URL ? raw.href : raw.url;
        const path = new URL(url, window.location.origin);
        if (path.origin === window.location.origin && path.pathname.startsWith("/api/") && path.pathname !== "/api/admin/login") {
          setExpired(true);
        }
      }
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  if (!expired) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-[100] flex items-center justify-between gap-3 bg-red-700 px-4 py-3 text-sm text-white shadow-lg">
      <span>登入已過期，畫面上的資料不是最新的。請重新登入。</span>
      <a href="/admin/login" className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg bg-white px-4 font-semibold text-red-700">
        重新登入
      </a>
    </div>
  );
}
