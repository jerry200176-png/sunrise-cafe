import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

// Force Update: Ensure image_url type is included
const supabaseAdmin = () =>
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

/**
 * 取得管理端用的 URL 與 Headers
 */
export const baseAdmin = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
});

export const headersAdmin = () => ({
  apikey: process.env.NEXT_PUBLIC_SUPABASE_KEY!,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
});

export function isAdminConfigured() {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export async function fetchBranches() {
  const { data, error } = await supabaseAdmin()
    .from("branches")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchBranch(branchId: string) {
  const { data, error } = await supabaseAdmin()
    .from("branches")
    .select("*")
    .eq("id", branchId)
    .single();
  if (error) return null;
  return data;
}

/**
 * 取得單一房間 (修正：加入 image_url)
 */
export async function fetchRoom(roomId: string): Promise<{
  id: string;
  branch_id: string;
  name: string;
  capacity: number;
  price_weekday: number;
  price_weekend: number;
  image_url: string | null; // ✅ 這裡就是 Vercel 報錯缺少的東西
} | null> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}&select=id,branch_id,name,capacity,price_weekday,price_weekend,image_url`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );

  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0] ?? null;
}

/**
 * 取得某分店所有房間 (簡易版)
 */
export async function fetchRooms(branchId: string): Promise<{ id: string; name: string; image_url: string | null }[]> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/rooms?branch_id=eq.${encodeURIComponent(branchId)}&select=id,name,image_url&order=name.asc`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!res.ok) throw new Error("Supabase rooms error: " + (await res.text()));
  return res.json();
}

/**
 * 取得某分店所有房間 (詳細版)
 */
export async function fetchRoomsWithDetails(branchId: string): Promise<
  { 
    id: string; 
    name: string; 
    capacity: number; 
    price_weekday: number; 
    price_weekend: number; 
    image_url: string | null;
  }[]
> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/rooms?branch_id=eq.${encodeURIComponent(branchId)}&select=id,name,capacity,price_weekday,price_weekend,image_url&order=name.asc`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch rooms: ${await res.text()}`);
  }

  return res.json();
}

export async function getBlockedSlots(branchId: string, date: string) {
  const { data, error } = await supabaseAdmin().rpc("get_blocked_slots", {
    p_branch_id: branchId,
    p_date: date,
  });
  if (error) {
    console.error("getBlockedSlots error:", error);
    return [];
  }
  return data as { room_id: string; start_time: string; end_time: string }[];
}

export async function insertReservationAdmin(payload: {
  room_id: string;
  customer_name: string;
  phone: string;
  email: string | null;
  start_time: string;
  end_time: string;
  status?: string; // Optional
  total_price: number | null;
  guest_count: number | null;
  notes: string | null;
}) {
  const bookingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const statusToUse = payload.status ?? "pending";

  const { data, error } = await supabaseAdmin()
    .from("reservations")
    .insert({
      room_id: payload.room_id,
      customer_name: payload.customer_name,
      phone: payload.phone,
      email: payload.email,
      start_time: payload.start_time,
      end_time: payload.end_time,
      status: statusToUse,
      total_price: payload.total_price,
      guest_count: payload.guest_count,
      notes: payload.notes,
      booking_code: bookingCode,
    })
    .select("id, booking_code")
    .single();

  if (error) throw error;
  return data;
}

export async function fetchReservationsAdmin(branchId: string): Promise<unknown[]> {
  const { url: baseUrl } = baseAdmin();
  const roomsRes = await fetch(
    `${baseUrl}/rest/v1/rooms?select=id&branch_id=eq.${encodeURIComponent(branchId)}`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!roomsRes.ok) throw new Error("Supabase rooms error: " + (await roomsRes.text()));
  
  const rooms = (await roomsRes.json()) as { id: string }[];
  if (rooms.length === 0) return [];

  const ids = rooms.map((r) => r.id);
  const inFilter = ids.map((id) => encodeURIComponent(id)).join(",");

  const res = await fetch(
    `${baseUrl}/rest/v1/reservations?select=*,room_with_branch:rooms(id,name,branch:branches(name))&room_id=in.(${inFilter})&order=start_time.asc`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!res.ok) throw new Error("Supabase reservations error: " + (await res.text()));

  return res.json();
}