"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="zh-TW">
      <body className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <h2 className="mb-2 text-xl font-semibold text-gray-800">系統發生錯誤</h2>
          <p className="mb-6 text-sm text-gray-500">
            我們已自動記錄這個問題，請稍後再試。
          </p>
          <button
            onClick={reset}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            重新整理
          </button>
        </div>
      </body>
    </html>
  );
}
