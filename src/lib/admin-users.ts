/**
 * Admin user persistence (service role).
 */
import { createClient } from "@supabase/supabase-js";
import type { AdminRole } from "@/lib/rbac";
import { hashAdminPassword } from "@/lib/admin-password";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type AdminUserRow = {
  id: string;
  email: string;
  display_name: string;
  role: AdminRole;
  is_active: boolean;
  created_at: string;
  branch_ids: string[];
};

export async function isAdminUsersTableReady(): Promise<boolean> {
  const { error } = await db().from("admin_users").select("id").limit(1);
  return !error?.message?.includes("admin_users");
}

export async function findAdminUserByEmail(email: string) {
  const { data, error } = await db()
    .from("admin_users")
    .select("id, email, password_hash, display_name, role, is_active")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const { data: users, error } = await db()
    .from("admin_users")
    .select("id, email, display_name, role, is_active, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const { data: links } = await db().from("admin_user_branches").select("user_id, branch_id");

  const byUser = new Map<string, string[]>();
  for (const row of links ?? []) {
    const list = byUser.get(row.user_id as string) ?? [];
    list.push(row.branch_id as string);
    byUser.set(row.user_id as string, list);
  }

  return (users ?? []).map((u) => ({
    id: u.id as string,
    email: u.email as string,
    display_name: u.display_name as string,
    role: u.role as AdminRole,
    is_active: u.is_active as boolean,
    created_at: u.created_at as string,
    branch_ids: u.role === "owner" ? [] : (byUser.get(u.id as string) ?? []),
  }));
}

export async function getAdminUserBranchIds(userId: string, role: AdminRole): Promise<string[] | null> {
  if (role === "owner") return null;
  const { data, error } = await db()
    .from("admin_user_branches")
    .select("branch_id")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.branch_id as string);
}

export async function createAdminUser(params: {
  email: string;
  password: string;
  display_name: string;
  role: AdminRole;
  branch_ids: string[];
}): Promise<{ id: string }> {
  const password_hash = await hashAdminPassword(params.password);
  const { data, error } = await db()
    .from("admin_users")
    .insert({
      email: params.email.toLowerCase().trim(),
      password_hash,
      display_name: params.display_name.trim(),
      role: params.role,
    })
    .select("id")
    .single();
  if (error) throw error;

  const userId = data.id as string;
  if (params.role !== "owner" && params.branch_ids.length > 0) {
    const { error: linkErr } = await db().from("admin_user_branches").insert(
      params.branch_ids.map((branch_id) => ({ user_id: userId, branch_id }))
    );
    if (linkErr) throw linkErr;
  }
  return { id: userId };
}

export async function updateAdminUser(
  userId: string,
  patch: {
    role?: AdminRole;
    display_name?: string;
    is_active?: boolean;
    branch_ids?: string[];
    password?: string;
  }
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.display_name !== undefined) row.display_name = patch.display_name;
  if (patch.is_active !== undefined) row.is_active = patch.is_active;
  if (patch.password) row.password_hash = await hashAdminPassword(patch.password);

  if (Object.keys(row).length > 1) {
    const { error } = await db().from("admin_users").update(row).eq("id", userId);
    if (error) throw error;
  }

  if (patch.branch_ids !== undefined) {
    await db().from("admin_user_branches").delete().eq("user_id", userId);
    const role = patch.role;
    const { data: current } = await db().from("admin_users").select("role").eq("id", userId).single();
    const effectiveRole = role ?? (current?.role as AdminRole);
    if (effectiveRole !== "owner" && patch.branch_ids.length > 0) {
      const { error: linkErr } = await db().from("admin_user_branches").insert(
        patch.branch_ids.map((branch_id) => ({ user_id: userId, branch_id }))
      );
      if (linkErr) throw linkErr;
    }
  }
}

export async function writePermissionAudit(params: {
  actor_user_id: string | null;
  target_user_id: string | null;
  action: string;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
}): Promise<void> {
  const { error } = await db().from("admin_permission_audit").insert({
    actor_user_id: params.actor_user_id,
    target_user_id: params.target_user_id,
    action: params.action,
    before_state: params.before_state ?? null,
    after_state: params.after_state ?? null,
  });
  if (error && !error.message.includes("admin_permission_audit")) throw error;
}

export async function writeAdminAuditLog(params: {
  actor_user_id: string | null;
  actor_label?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  branch_id?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await db().from("admin_audit_logs").insert({
    actor_user_id: params.actor_user_id,
    actor_label: params.actor_label ?? null,
    action: params.action,
    resource_type: params.resource_type ?? null,
    resource_id: params.resource_id ?? null,
    branch_id: params.branch_id ?? null,
    metadata: params.metadata ?? {},
  });
  if (error && !error.message.includes("admin_audit_logs")) throw error;
}
