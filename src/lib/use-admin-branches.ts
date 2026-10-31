"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { responseError, thrownMessage } from "@/lib/friendly-error";
import type { Branch } from "@/types";

/** Shared read-only branch bootstrap for admin pages. Errors must not look like an empty list. */
export function useAdminBranches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const retry = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout("/api/branches", { credentials: "include" });
      if (!res.ok) throw new Error(await responseError(res));
      const rows: unknown = await readJsonWithTimeout(res);
      if (!Array.isArray(rows)) throw new Error("分店資料格式不正確，請重試");
      if (current === sequence.current) setBranches(rows as Branch[]);
    } catch (err) {
      if (current === sequence.current) {
        setError(thrownMessage(err, "無法載入分店，請重試"));
      }
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const requests = sequence;
    void retry();
    return () => { requests.current++; };
  }, [retry]);

  return { branches, loading, error, retry };
}
