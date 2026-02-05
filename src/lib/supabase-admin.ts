/**
 * Server-only Supabase 後端：使用 SERVICE_ROLE_KEY 讀寫 reservations 等，
 * 供 API 路由使用（時段查詢、訂位防呆、我的訂位、儀表板）。
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

function baseAdmin() {
  if (!url || !serviceKey)
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return { url: url.replace(/\/$/, ""), key: serviceKey };
}

function headersAdmin(extra: HeadersInit = {}) {
  const { key } = baseAdmin();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export function isAdminConfigured(): boolean {
  return Boolean(url && serviceKey);
}

export async function fetchBranch(branchId: string): Promise<{
  id: string;
  name: string;
  open_time: string | null;
  close_time: string | null;
} | null> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/branches?id=eq.${encodeURIComponent(branchId)}&select=id,name,open_time,close_time`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!res.ok) return null;
  const arr = await res.json();
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

export async function fetchRoom(roomId: string): Promise<{
  id: string;
  branch_id: string;
  name: string;
  capacity: number;
  price_weekday: number;
  price_weekend: number;
} | null> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/rooms?id=eq.${encodeURIComponent(roomId)}&select=id,branch_id,name,capacity,price_weekday,price_weekend`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!res.ok) return null;
  const arr = await res.json();
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

export async function fetchRooms(branchId: string): Promise<{ id: string; name: string }[]> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/rooms?branch_id=eq.${encodeURIComponent(branchId)}&select=id,name&order=name.asc`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchRoomsWithDetails(branchId: string): Promise<
  { id: string; name: string; capacity: number; price_weekday: number; price_weekend: number }[]
> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/rooms?branch_id=eq.${encodeURIComponent(branchId)}&select=id,name,capacity,price_weekday,price_weekend&order=name.asc`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** 呼叫 Postgres 函式 get_blocked_slots，回傳該分店該日已佔用時段（無個資） */
export async function getBlockedSlots(
  branchId: string,
  date: string
): Promise<{ room_id: string; start_time: string; end_time: string }[]> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(`${baseUrl}/rest/v1/rpc/get_blocked_slots`, {
    method: "POST",
    headers: headersAdmin(),
    body: JSON.stringify({
      p_branch_id: branchId,
      p_date: date,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`get_blocked_slots: ${res.status} ${text || res.statusText}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** 依分店取得訂位（供管理端、儀表板） */
export async function fetchReservationsAdmin(branchId: string): Promise<unknown[]> {
  const roomsRes = await fetch(
    `${baseAdmin().url}/rest/v1/rooms?select=id&branch_id=eq.${encodeURIComponent(branchId)}`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!roomsRes.ok) throw new Error("Supabase rooms: " + (await roomsRes.text()));
  const rooms = (await roomsRes.json()) as { id: string }[];
  if (rooms.length === 0) return [];
  const ids = rooms.map((r) => r.id);
  const inFilter = ids.map((id) => encodeURIComponent(id)).join(",");
  const res = await fetch(
    `${baseAdmin().url}/rest/v1/reservations?select=*&room_id=in.(${inFilter})&order=start_time.asc`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!res.ok) throw new Error("Supabase reservations: " + (await res.text()));
  return res.json();
}

/** 檢查該時段是否已被預訂（排除 cancelled；可選排除某 id） */
export async function hasSlotConflict(
  roomId: string,
  startTime: string,
  endTime: string,
  excludeId?: string
): Promise<boolean> {
  const { url: baseUrl } = baseAdmin();
  const q = [
    "select=id",
    `room_id=eq.${encodeURIComponent(roomId)}`,
    "status=not.in.(cancelled)",
    `start_time=lt.${encodeURIComponent(endTime)}`,
    `end_time=gt.${encodeURIComponent(startTime)}`,
    "limit=1",
    ...(excludeId ? [`id=neq.${encodeURIComponent(excludeId)}`] : []),
  ].join("&");
  const res = await fetch(
    `${baseUrl}/rest/v1/reservations?${q}`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!res.ok) return true;
  const arr = await res.json();
  return Array.isArray(arr) && arr.length > 0;
}

/** 產生 8 碼訂位代號 */
function generateBookingCode(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

/** 新增訂位（含 booking_code、email）；回傳含 id 與 booking_code 的資料 */
export async function insertReservationAdmin(body: {
  room_id: string;
  customer_name: string;
  phone: string;
  email?: string | null;
  start_time: string;
  end_time: string;
  status?: string;
  total_price?: number | null;
  guest_count?: number | null;
  notes?: string | null;
}): Promise<{ id: string; booking_code: string }> {
  const { url: baseUrl } = baseAdmin();
  const bookingCode = generateBookingCode();
  const payload = {
    ...body,
    booking_code: bookingCode,
    status: body.status ?? "confirmed",
    email: body.email ?? null,
    guest_count: body.guest_count ?? null,
    notes: body.notes ?? null,
    total_price: body.total_price ?? null,
  };
  const res = await fetch(`${baseUrl}/rest/v1/reservations`, {
    method: "POST",
    headers: headersAdmin({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Supabase insert: " + (await res.text()));
  const arr = await res.json();
  const row = Array.isArray(arr) ? arr[0] : null;
  if (!row?.id) throw new Error("Insert did not return id");
  return { id: row.id, booking_code: row.booking_code || bookingCode };
}

export async function updateReservationAdmin(
  id: string,
  patch: Partial<{
    customer_name: string;
    phone: string;
    email: string | null;
    start_time: string;
    end_time: string;
    status: string;
    total_price: number | null;
    guest_count: number | null;
    notes: string | null;
    is_notified: boolean;
  }>
): Promise<void> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(`${baseUrl}/rest/v1/reservations?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headersAdmin({ Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Supabase reservation update: " + (await res.text()));
}

/** 永久刪除訂位（Admin 權限） */
export async function deleteReservationAdmin(id: string): Promise<void> {
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(`${baseUrl}/rest/v1/reservations?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headersAdmin({ Prefer: "return=minimal" }),
  });
  if (!res.ok) throw new Error("Supabase reservation delete: " + (await res.text()));
}

/** 依電話查詢訂位（僅回傳必要欄位，供「我的訂位」） */
export async function fetchReservationsByPhone(phone: string): Promise<
  {
    id: string;
    booking_code: string;
    room_id: string;
    start_time: string;
    end_time: string;
    status: string;
    total_price: number | null;
    guest_count: number | null;
    customer_name: string;
  }[]
> {
  const normalized = phone.replace(/\s/g, "");
  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/reservations?select=id,booking_code,room_id,start_time,end_time,status,total_price,guest_count,customer_name&phone=eq.${encodeURIComponent(normalized)}&order=start_time.desc`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** 查詢「預約日期為明天」且尚未發送提醒的訂位（供提醒排程使用） */
export async function fetchReservationsForReminder(): Promise<
  {
    id: string;
    booking_code: string;
    room_id: string;
    start_time: string;
    end_time: string;
    customer_name: string;
    phone: string;
    email: string | null;
  }[]
> {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);
  const tomorrowStart = `${dateStr}T00:00:00.000Z`;
  const tomorrowEnd = `${dateStr}T23:59:59.999Z`;

  const { url: baseUrl } = baseAdmin();
  const res = await fetch(
    `${baseUrl}/rest/v1/reservations?select=id,booking_code,room_id,start_time,end_time,customer_name,phone,email` +
      `&start_time=gte.${encodeURIComponent(tomorrowStart)}` +
      `&start_time=lte.${encodeURIComponent(tomorrowEnd)}` +
      `&is_notified=eq.false` +
      `&status=neq.cancelled` +
      `&order=start_time.asc`,
    { method: "GET", headers: headersAdmin(), cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
