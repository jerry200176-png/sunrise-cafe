"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { friendlyMessage, thrownMessage } from "@/lib/friendly-error";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import type { LineAccountAudit, LineAccountReport } from "@/lib/line-account-audit";

const ROLE_LABEL = { group: "店員群組通知", customer: "客人通知" } as const;
/** Colour by assessLineQuota level (80% warn, 95% critical; shared with diagnose-line). */
const LEVEL_CLASS = { ok: "text-stone-500", warn: "font-semibold text-amber-700", critical: "font-semibold text-rose-700", unknown: "text-stone-500" } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLineAccountAudit(value: unknown): value is LineAccountAudit {
  if (!isRecord(value) || typeof value.fetchedAt !== "string" || typeof value.identityComplete !== "boolean"
    || !Array.isArray(value.accounts) || !Array.isArray(value.collisions)) return false;
  const accountsValid = value.accounts.every((account) => {
    if (!isRecord(account) || !(account.role === "group" || account.role === "customer")
      || typeof account.source !== "string" || typeof account.configured !== "boolean"
      || !(account.displayName === null || typeof account.displayName === "string")
      || !(account.basicId === null || typeof account.basicId === "string")
      || !(account.error === null || typeof account.error === "string")) return false;
    if (account.usage === null) return true;
    if (!isRecord(account.usage)) return false;
    const usage = account.usage;
    const nullableNumber = (item: unknown) => item === null || (typeof item === "number" && Number.isFinite(item));
    return typeof usage.status === "string" && nullableNumber(usage.monthUsed) && nullableNumber(usage.monthLimit)
      && (usage.planType === null || usage.planType === "none" || usage.planType === "limited")
      && nullableNumber(usage.todayPush)
      && (usage.level === "ok" || usage.level === "warn" || usage.level === "critical" || usage.level === "unknown")
      && nullableNumber(usage.percentUsed);
  });
  const collisionsValid = value.collisions.every((collision) => isRecord(collision)
    && typeof collision.customerSource === "string" && typeof collision.groupSource === "string"
    && (collision.displayName === null || typeof collision.displayName === "string")
    && (collision.basicId === null || typeof collision.basicId === "string"));
  return accountsValid && collisionsValid;
}

async function boundedError(response: Response): Promise<string> {
  try {
    const body = await readJsonWithTimeout<{ error?: unknown; message?: unknown }>(response.clone());
    return friendlyMessage(body?.error ?? body?.message, response.status);
  } catch {
    return friendlyMessage(undefined, response.status);
  }
}

/** 老闆用：每個 LINE token 實際是哪個官方帳號，以及本月額度用了多少（唯讀，不發訊息）。 */
export default function LineAccountsPage() {
  const [audit, setAudit] = useState<LineAccountAudit | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError("");
    setAudit(null);
    try {
      const response = await fetchWithTimeout("/api/admin/line-accounts", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error(await boundedError(response));
      const data = await readJsonWithTimeout<unknown>(response);
      if (sequence !== loadSequence.current) return;
      if (!isLineAccountAudit(data)) throw new Error("LINE 帳號資料格式錯誤，請重新整理");
      setAudit(data);
    } catch (cause) {
      if (sequence === loadSequence.current) setError(thrownMessage(cause, "讀不到 LINE 帳號資料，請重試"));
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <AdminShell title="LINE 帳號檢查" subtitle="每個設定實際連到哪個 LINE 官方帳號、本月訊息額度用了多少" showNav={false}
      actions={<button type="button" onClick={() => void load()} disabled={loading} aria-label="重新整理"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100 disabled:opacity-50">
        <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.5} />
      </button>}>
      <div className="space-y-4 pb-16">
        {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} disabled={loading} className="h-9 rounded-lg border border-rose-300 bg-white px-3 font-medium disabled:opacity-50">重試</button>
        </div>}
        {!audit && !error && <p className="py-10 text-center text-sm text-stone-500">讀取中…</p>}
        {audit && (audit.collisions.length > 0
          ? <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
            <p className="font-semibold">設定錯誤：客人通知用的是店員群組的帳號</p>
            <ul className="mt-2 list-disc pl-5">{audit.collisions.map((c) => <li key={c.customerSource + c.groupSource}>
              {c.customerSource} 和 {c.groupSource} 都是「{c.displayName ?? "?"}」{c.basicId ?? ""}</li>)}</ul>
            <p className="mt-2">兩邊共用同一份每月額度。請到 Vercel 把客人帳號的 token 換回來，再 Redeploy。</p>
          </div>
          : !audit.identityComplete
            ? <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              有帳號讀不到身分（下面標紅字的卡片），所以還不能確定客人通知和店員群組是不是不同帳號。請先修正那個 token 再重新整理。</p>
            : <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">客人通知和店員群組用的是不同的 LINE 帳號。</p>)}
        {audit && <ul className="grid gap-3 sm:grid-cols-2">{audit.accounts.map((account) => <AccountCard key={account.source} account={account} />)}</ul>}
        {audit && <p className="text-xs text-stone-500">資料時間 {new Date(audit.fetchedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}。
          群組推播會按「群組人數」計算訊息數。今天的推播數 LINE 隔天才會給，所以可能顯示「—」。</p>}
      </div>
    </AdminShell>
  );
}

function AccountCard({ account }: { account: LineAccountReport }) {
  const usage = account.usage;
  const limitText = usage?.planType === "none" ? "不限" : usage?.monthLimit != null ? usage.monthLimit.toLocaleString() : "—";
  return <li className="rounded-2xl border border-stone-200 bg-white p-4">
    <p className="text-xs text-stone-500">{ROLE_LABEL[account.role]} · <code>{account.source}</code></p>
    <p className="mt-1 text-lg font-semibold">{account.displayName ?? (account.configured ? "（讀不到帳號名稱）" : "未設定")}</p>
    {account.basicId && <p className="text-sm text-stone-600">LINE ID {account.basicId}</p>}
    {account.error && <p className="mt-1 text-sm text-rose-700">{account.error}</p>}
    {usage && <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
      <div><dt className="text-xs text-stone-500">本月已用</dt><dd className="tabular-nums">{usage.monthUsed?.toLocaleString() ?? "—"}</dd></div>
      <div><dt className="text-xs text-stone-500">本月上限</dt><dd className="tabular-nums">{limitText}</dd></div>
      <div><dt className="text-xs text-stone-500">今天推播</dt><dd className="tabular-nums">{usage.todayPush ?? "—"}</dd></div>
    </dl>}
    {usage?.percentUsed != null && <p className={`mt-2 text-xs ${LEVEL_CLASS[usage.level]}`}>已用 {usage.percentUsed}%</p>}
  </li>;
}
