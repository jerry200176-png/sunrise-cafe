// 對應 Supabase 表 branches
export interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  open_time: string | null;
  close_time: string | null;
  created_at: string;
}

// 對應 Supabase 表 rooms（平日/假日分開定價）
export interface Room {
  id: string;
  branch_id: string;
  name: string;
  type: string | null;
  capacity: number;
  price_weekday: number;
  price_weekend: number;
  image_url?: string | null;
  created_at?: string;
}

// 包廂預約（含 booking_code、email；status 對齊 DB）
export interface Reservation {
  id: string;
  room_id: string;
  customer_name: string;
  phone: string;
  email?: string | null;
  start_time: string;
  end_time: string;
  status: ReservationStatus;
  total_price: number | null;
  guest_count: number | null;
  notes: string | null;
  booking_code?: string;
  is_notified?: boolean;
  created_at: string;
}

export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "cancelled"
  | "completed";

// 對應 Supabase 表 settings
export interface Settings {
  id: string;
  current_branch_id: string | null;
  updated_at: string;
}
