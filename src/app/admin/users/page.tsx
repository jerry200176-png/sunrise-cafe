"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, UserPlus, RefreshCw, Shield } from "lucide-react";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { responseError, thrownMessage } from "@/lib/friendly-error";

type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  branch_ids: string[];
};

type Me = {
  role: string;
  permissions: { users_manage: boolean };
};

export default function AdminUsersPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("branch_manager");
  const [branchIds, setBranchIds] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meRes, usersRes] = await Promise.all([
        fetchWithTimeout("/api/admin/me"),
        fetchWithTimeout("/api/admin/users"),
      ]);
      if (usersRes.status === 403) {
        setError("僅 Owner 可管理使用者");
        return;
      }
      if (!usersRes.ok) throw new Error(await responseError(usersRes));
      if (!meRes.ok) throw new Error(await responseError(meRes));
      setMe(await readJsonWithTimeout<Me>(meRes));
      const uData = await readJsonWithTimeout<{ users?: AdminUser[]; migration_required?: boolean }>(usersRes);
      setUsers(uData.users ?? []);
      setMigrationRequired(Boolean(uData.migration_required));
    } catch (e) {
      setError(thrownMessage(e, "使用者資料載入失敗，請重新整理"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        display_name: displayName || email,
        role,
        branch_ids: branchIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "建立失敗");
      return;
    }
    setEmail("");
    setPassword("");
    setDisplayName("");
    load();
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 p-6">
        <p className="text-stone-500">載入使用者…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Link href="/admin" className="text-stone-400 hover:text-stone-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Shield className="h-5 w-5 text-violet-600" />
          <h1 className="font-semibold text-stone-800">使用者與權限</h1>
          {me && (
            <span className="ml-auto text-xs text-stone-400">目前角色：{me.role}</span>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {migrationRequired && (
          <p className="text-sm text-amber-800">
            請執行 <code className="rounded bg-amber-50 px-1">migration-phase7-rbac.sql</code>
          </p>
        )}

        {me?.permissions.users_manage && !migrationRequired && (
          <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-stone-800">
              <UserPlus className="h-4 w-4" /> 新增使用者
            </h2>
            <form onSubmit={createUser} className="space-y-3 text-sm">
              <input
                type="email"
                required
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-stone-200 px-3 py-2"
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="密碼（至少 8 字）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-stone-200 px-3 py-2"
              />
              <input
                type="text"
                placeholder="顯示名稱"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-stone-200 px-3 py-2"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-lg border border-stone-200 px-3 py-2"
              >
                <option value="owner">Owner</option>
                <option value="branch_manager">Branch manager</option>
                <option value="staff">Staff</option>
                <option value="finance">Finance</option>
              </select>
              <input
                type="text"
                placeholder="分店 UUID（逗號分隔，owner 可留空）"
                value={branchIds}
                onChange={(e) => setBranchIds(e.target.value)}
                className="w-full rounded-lg border border-stone-200 px-3 py-2"
              />
              <button
                type="submit"
                className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white hover:bg-amber-700"
              >
                建立
              </button>
            </form>
          </section>
        )}

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-stone-800">使用者清單</h2>
            <button type="button" onClick={load} className="text-stone-500 hover:text-stone-700">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          {users.length === 0 ? (
            <p className="text-sm text-stone-400">尚無 RBAC 使用者（仍可使用 ADMIN_PASSWORD 登入）</p>
          ) : (
            <ul className="divide-y text-sm">
              {users.map((u) => (
                <li key={u.id} className="py-2">
                  <p className="font-medium text-stone-800">{u.display_name || u.email}</p>
                  <p className="text-stone-500">
                    {u.email} · {u.role}
                    {!u.is_active && " · 已停用"}
                  </p>
                  {u.branch_ids.length > 0 && (
                    <p className="text-xs text-stone-400">分店：{u.branch_ids.join(", ")}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-center text-xs text-stone-400">
          權限說明見 <code>docs/RBAC.md</code>
        </p>
      </div>
    </main>
  );
}
