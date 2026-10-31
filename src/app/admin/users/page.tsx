"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, UserPlus, RefreshCw, Shield } from "lucide-react";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { friendlyMessage, responseError, thrownMessage } from "@/lib/friendly-error";

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

const CREATE_PENDING_KEY = "sunrise.admin-user-create.pending.v1";
const UNKNOWN_MESSAGE = "建立結果尚未確認。請先重新整理並核對使用者清單、角色與分店；原請求可能稍後才完成，請勿立即重送。";

function clearCreateHold() {
  sessionStorage.removeItem(CREATE_PENDING_KEY);
  if (sessionStorage.getItem(CREATE_PENDING_KEY)) throw new Error("storage unavailable");
}

export default function AdminUsersPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [listVerified, setListVerified] = useState(false);
  const createInFlight = useRef(false);
  const listSequence = useRef(0);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("branch_manager");
  const [branchIds, setBranchIds] = useState("");

  const load = useCallback(async () => {
    const sequence = ++listSequence.current;
    setListVerified(false);
    setLoading(true);
    setError(null);
    try {
      const [meRes, usersRes] = await Promise.all([
        fetchWithTimeout("/api/admin/me"),
        fetchWithTimeout("/api/admin/users"),
      ]);
      if (sequence !== listSequence.current) return null;
      if (usersRes.status === 403) {
        setError("僅 Owner 可管理使用者");
        return null;
      }
      if (!usersRes.ok) throw new Error(await responseError(usersRes));
      if (!meRes.ok) throw new Error(await responseError(meRes));
      const currentMe = await readJsonWithTimeout<Me>(meRes);
      const uData = await readJsonWithTimeout<{ users?: AdminUser[]; migration_required?: boolean }>(usersRes);
      if (sequence !== listSequence.current) return null;
      if (!currentMe || typeof currentMe.permissions?.users_manage !== "boolean") throw new Error("使用者權限資料格式不正確，請重新整理");
      if (!Array.isArray(uData.users) || uData.users.some((user) => !user || typeof user.id !== "string" ||
          typeof user.email !== "string" || typeof user.role !== "string" || !Array.isArray(user.branch_ids) ||
          user.branch_ids.some((id) => typeof id !== "string"))) throw new Error("使用者清單格式不正確，請重新整理");
      setMe(currentMe);
      setUsers(uData.users);
      setMigrationRequired(Boolean(uData.migration_required));
      return !uData.migration_required && currentMe.permissions.users_manage ? sequence : null;
    } catch (e) {
      if (sequence === listSequence.current) setError(thrownMessage(e, "使用者資料載入失敗，請重新整理"));
      return null;
    } finally {
      if (sequence === listSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(CREATE_PENDING_KEY)) { setUnknown(true); setCreateMessage(UNKNOWN_MESSAGE); }
    } catch {
      setUnknown(true);
      setCreateMessage("無法安全保存建立狀態，請檢查瀏覽器儲存功能後再操作。");
    }
    load();
  }, [load]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createInFlight.current || unknown) return;
    createInFlight.current = true;
    setCreating(true);
    setCreateMessage(null);
    try {
      // Store no email, password or request body. The hold survives a reload
      // if the browser loses the response or the page closes mid-request.
      try {
        sessionStorage.setItem(CREATE_PENDING_KEY, "1");
        if (sessionStorage.getItem(CREATE_PENDING_KEY) !== "1") throw new Error("storage unavailable");
      } catch {
        setUnknown(true);
        setCreateMessage("無法安全保存建立狀態，尚未送出請求；請檢查瀏覽器儲存功能。");
        return;
      }
      const res = await fetchWithTimeout("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName || email,
          role,
          branch_ids: branchIds.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await readJsonWithTimeout<{ ok?: boolean; id?: unknown; error?: unknown }>(res);
      if (!res.ok && [400, 401, 403, 404, 422].includes(res.status) && typeof data?.error === "string") {
        clearCreateHold();
        setCreateMessage(friendlyMessage(data.error, res.status));
        return;
      }
      if (!res.ok || data?.ok !== true || typeof data.id !== "string" || !data.id) throw new Error("unknown outcome");
      setPassword("");
      if (!await load()) {
        setUnknown(true);
        setListVerified(false);
        setCreateMessage("帳號已建立，但清單未能更新；請重新整理並核對角色與分店，暫勿再次建立。");
      } else {
        clearCreateHold();
        setEmail("");
        setDisplayName("");
        setCreateMessage("帳號已建立，請確認清單中的角色與分店。");
      }
    } catch {
      setPassword("");
      setListVerified(false);
      setUnknown(true);
      setCreateMessage(UNKNOWN_MESSAGE);
    } finally {
      createInFlight.current = false;
      setCreating(false);
    }
  };

  const verifyList = async () => {
    setListVerified(false);
    const sequence = await load();
    if (sequence && sequence === listSequence.current) setListVerified(true);
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

        {createMessage && <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{createMessage}</div>}
        {unknown && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>請核對清單中是否已有此帳號，以及角色和分店是否完整。若尚未出現，原請求仍可能稍後完成。</p>
          <button type="button" onClick={() => void verifyList()} disabled={loading || creating} className="mt-2 rounded-lg border border-amber-700 px-3 py-2 disabled:opacity-50">重新整理並核對清單</button>
          {listVerified && <button type="button" onClick={() => {
            if (window.confirm("原請求仍可能稍後完成。你已核對帳號、角色及分店，並了解再次建立可能重複嗎？")) {
              try {
                clearCreateHold();
                setUnknown(false); setListVerified(false); setCreateMessage(null);
              } catch { setCreateMessage("無法保存確認結果，請檢查瀏覽器儲存功能。"); }
            }
          }} className="ml-2 mt-2 rounded-lg border border-amber-700 px-3 py-2">已核對，允許重新操作</button>}
        </div>}

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
                disabled={creating || unknown}
                className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {creating ? "建立中…" : "建立"}
              </button>
            </form>
          </section>
        )}

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-stone-800">使用者清單</h2>
            <button type="button" onClick={load} disabled={loading} aria-label="重新整理使用者清單" className="text-stone-500 hover:text-stone-700 disabled:opacity-50">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          {error ? (
            <p className="text-sm text-stone-500">無法確認使用者清單，請重新整理。</p>
          ) : users.length === 0 ? (
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
                  {u.role !== "owner" && u.branch_ids.length === 0 && (
                    <p className="text-xs text-amber-800">未設定分店，請核對</p>
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
