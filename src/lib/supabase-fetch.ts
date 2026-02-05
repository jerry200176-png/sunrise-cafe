/**
 * 用原生 fetch 呼叫 Supabase REST API（PostgREST），
 * 避免 @supabase/supabase-js 在 Node 環境的連線問題。
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

function base() {
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url: url.replace(/\/$/, ""), key };
}

function headers(extra: HeadersInit = {}) {
  const { key: k } = base();
  return {
    apikey: k,
    Authorization: `Bearer ${k}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function fetchBranches(): Promise<unknown[]> {
  const { url: baseUrl } = base();
  const res = await fetch(`${baseUrl}/rest/v1/branches?select=*&order=name.asc`, {
    method: "GET",
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase branches: ${res.status} ${text || res.statusText}`);
  }
  return res.json();
}

export async function insertBranch(body: {
  name: string;
  address?: string | null;
  phone?: string | null;
  open_time?: string | null;
  close_time?: string | null;
}): Promise<void> {
  const { url: baseUrl } = base();
  const res = await fetch(`${baseUrl}/rest/v1/branches`, {
    method: "POST",
    headers: headers({ Prefer: "return=minimal" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase branches insert: ${res.status} ${text || res.statusText}`);
  }
}

export async function updateBranch(
  id: string,
  body: Partial<{ name: string; address: string | null; phone: string | null; open_time: string | null; close_time: string | null }>
): Promise<void> {
  const { url: baseUrl } = base();
  const res = await fetch(`${baseUrl}/rest/v1/branches?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=minimal" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase branches update: ${res.status} ${text || res.statusText}`);
  }
}

export async function deleteBranch(id: string): Promise<void> {
  const { url: baseUrl } = base();
  const res = await fetch(`${baseUrl}/rest/v1/branches?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase branches delete: ${res.status} ${text || res.statusText}`);
  }
}

export async function fetchSettings(): Promise<{ current_branch_id: string | null }> {
  const { url: baseUrl } = base();
  const res = await fetch(
    `${baseUrl}/rest/v1/settings?id=eq.app&select=current_branch_id`,
    { method: "GET", headers: headers(), cache: "no-store" }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase settings: ${res.status} ${text || res.statusText}`);
  }
  const arr = await res.json();
  const row = Array.isArray(arr) ? arr[0] : null;
  return { current_branch_id: row?.current_branch_id ?? null };
}

export async function updateSettings(current_branch_id: string | null): Promise<void> {
  const { url: baseUrl } = base();
  const res = await fetch(`${baseUrl}/rest/v1/settings?id=eq.app`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      current_branch_id,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase settings update: ${res.status} ${text || res.statusText}`);
  }
}

// --- Rooms ---
export async function fetchRooms(branchId: string): Promise<unknown[]> {
  const { url: baseUrl } = base();
  const res = await fetch(
    `${baseUrl}/rest/v1/rooms?select=*&branch_id=eq.${encodeURIComponent(branchId)}&order=name.asc`,
    { method: "GET", headers: headers(), cache: "no-store" }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase rooms: ${res.status} ${text || res.statusText}`);
  }
  return res.json();
}

export async function insertRoom(body: {
  branch_id: string;
  name: string;
  type?: string | null;
  capacity: number;
  price_weekday: number;
  price_weekend: number;
}): Promise<void> {
  const { url: baseUrl } = base();
  const res = await fetch(`${baseUrl}/rest/v1/rooms`, {
    method: "POST",
    headers: headers({ Prefer: "return=minimal" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase rooms insert: ${res.status} ${text || res.statusText}`);
  }
}

export async function updateRoom(
  id: string,
  body: Partial<{ name: string; type: string | null; capacity: number; price_weekday: number; price_weekend: number }>
): Promise<void> {
  const { url: baseUrl } = base();
  const res = await fetch(`${baseUrl}/rest/v1/rooms?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=minimal" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase rooms update: ${res.status} ${text || res.statusText}`);
  }
}

export async function deleteRoom(id: string): Promise<void> {
  const { url: baseUrl } = base();
  const res = await fetch(`${baseUrl}/rest/v1/rooms?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase rooms delete: ${res.status} ${text || res.statusText}`);
  }
}

/** 依分店取得訂位（經由該分店底下所有 room_id） */
export async function fetchReservations(branchId: string): Promise<unknown[]> {
  const rooms = (await fetchRooms(branchId)) as { id: string }[];
  if (rooms.length === 0) return [];
  const ids = rooms.map((r) => r.id);
  const { url: baseUrl } = base();
  const inFilter = ids.map((id) => encodeURIComponent(id)).join(",");
  const res = await fetch(
    `${baseUrl}/rest/v1/reservations?select=*&room_id=in.(${inFilter})&order=start_time.asc`,
    { method: "GET", headers: headers(), cache: "no-store" }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase reservations: ${res.status} ${text || res.statusText}`);
  }
  return res.json();
}

export async function insertReservation(body: {
  room_id: string;
  customer_name: string;
  phone: string;
  start_time: string;
  end_time: string;
  status?: string;
  total_price?: number | null;
  guest_count?: number | null;
  notes?: string | null;
}): Promise<void> {
  const { url: baseUrl } = base();
  const payload: Record<string, unknown> = { ...body, status: body.status ?? "reserved" };
  if (body.guest_count !== undefined) payload.guest_count = body.guest_count;
  if (body.notes !== undefined) payload.notes = body.notes;
  const res = await fetch(`${baseUrl}/rest/v1/reservations`, {
    method: "POST",
    headers: headers({ Prefer: "return=minimal" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase insert: ${res.status} ${text || res.statusText}`);
  }
}

export async function updateReservation(
  id: string,
  patch: Partial<{
    customer_name: string;
    phone: string;
    start_time: string;
    end_time: string;
    status: string;
    total_price: number | null;
    guest_count: number | null;
    notes: string | null;
  }>
): Promise<void> {
  const { url: baseUrl } = base();
  const res = await fetch(`${baseUrl}/rest/v1/reservations?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase reservation update: ${res.status} ${text || res.statusText}`);
  }
}
