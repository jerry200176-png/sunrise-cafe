// 對應 Supabase 表 branches
export interface Branch {
  id: string;
  name: string;
  display_name?: string | null;
  address: string | null;
  phone: string | null;
  open_time: string | null;
  close_time: string | null;
  closed_dates?: string[];
  payment_info?: string | null;
  line_pay_url?: string | null;
  created_at: string;
}

// 對應 Supabase 表 rooms（平日/假日分開定價）
export interface Room {
  id: string;
  branch_id: string;
  name: string;
  type: string | null;
  min_capacity?: number;
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
  is_deposit_paid?: boolean;
  line_user_id?: string | null;
  deposit_payment_note?: string | null;
  deposit_approved_notified_at?: string | null;
  review_invited_at?: string | null;
  /** Pending payment_events awaiting staff review */
  pending_payment_reviews?: number;
  /** Guest tapped D-1 Confirm attendance CTA */
  guest_confirmed_at?: string | null;
  room_with_branch?: {
    id: string;
    name: string;
    branch?: {
      name: string;
    } | null;
  } | null;
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
  closed_dates: string[];
  deposit_info: string | null;
  google_review_url: string | null;
}

export interface RentalNoteSection {
  title: string;
  items: string[];
}

// ── 自助點餐模組 ──────────────────────────────────────────

export interface Table {
  id: string;
  branch_id: string;
  number: string;
  qr_token: string;
  is_active: boolean;
  created_at: string;
}

export interface MenuCategory {
  id: string;
  branch_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export interface MenuItem {
  id: string;
  branch_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
  display_order: number;
  created_at: string;
  options?: MenuItemOption[];
}

export interface MenuItemOption {
  id: string;
  item_id: string;
  option_group: string;
  option_name: string;
  price_delta: number;
  display_order: number;
}

export interface SelectedOption {
  group: string;
  name: string;
  delta: number;
}

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  selectedOptions: SelectedOption[];
  specialNotes: string;
}

export interface Order {
  id: string;
  branch_id: string;
  table_id: string | null;
  status: OrderStatus;
  total_amount: number;
  notes: string | null;
  is_printed: boolean;
  created_at: string;
  table?: Table | null;
  order_items?: OrderItem[];
}

export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  item_name: string;
  quantity: number;
  unit_price: number;
  selected_options: SelectedOption[] | null;
  special_notes: string | null;
}

// ── Stripe 支付模組 ──────────────────────────────────────────

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";

export interface PaymentIntentRecord {
  id: string;
  stripe_pi_id: string;
  reservation_id: string;
  branch_id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateIntentRequest {
  reservationId: string;
  branchId: string;
  amount: number;
  currency?: string;
}

export interface CreateIntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
}

export interface ConfirmDepositRequest {
  paymentIntentId: string;
  reservationId: string;
}

export interface ConfirmDepositResponse {
  status: string;
  depositStatus: string;
}

/** 分店訂金設定 */
export interface BranchDepositConfig {
  isDepositRequired: boolean;
  stripeEnabled: boolean;
  defaultDepositAmount: number;
}
