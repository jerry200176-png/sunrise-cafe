import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isReservationMessageTemplateKey,
  renderReservationMessage,
  type ReservationMessageAction,
  type ReservationMessageChannel,
  type ReservationMessageReservation,
  type ReservationMessageTemplateKey,
} from "@/lib/reservation-message";
import type { BranchPaymentConfig } from "@/lib/payment-message";

type BranchRow = BranchPaymentConfig & { id: string };
type RoomRow = {
  name?: string | null;
  branch?: BranchRow | BranchRow[] | null;
};

export type ReservationMessageContext = {
  branchId: string;
  reservation: ReservationMessageReservation;
  branch: BranchPaymentConfig;
};

export type BatchReservationMessageContext = ReservationMessageContext & {
  reservationId: string;
  phone: string;
  email: string | null;
  status: string | null;
};

function defaultClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function fetchReservationMessageContext(
  reservationId: string,
  client: SupabaseClient = defaultClient()
): Promise<ReservationMessageContext | null> {
  const { data, error } = await client
    .from("reservations")
    .select(
      `customer_name, start_time, end_time, total_price, guest_count, booking_code,
       created_at, is_deposit_paid,
       room:rooms(name, branch:branches(*))`
    )
    .eq("id", reservationId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const room = first(row.room as RoomRow | RoomRow[] | null);
  const branch = first(room?.branch);
  if (!branch?.id) return null;

  return {
    branchId: branch.id,
    reservation: {
      customer_name: String(row.customer_name ?? ""),
      start_time: String(row.start_time),
      end_time: String(row.end_time),
      total_price: row.total_price == null ? null : Number(row.total_price),
      guest_count: row.guest_count == null ? null : Number(row.guest_count),
      booking_code: (row.booking_code as string | null | undefined) ?? null,
      created_at: (row.created_at as string | null | undefined) ?? null,
      is_deposit_paid: Boolean(row.is_deposit_paid),
      room_name: room?.name ?? null,
    },
    branch,
  };
}

export async function renderReservationMessageById(
  reservationId: string,
  templateKey: ReservationMessageTemplateKey,
  client?: SupabaseClient
): Promise<{ context: ReservationMessageContext; text: string } | null> {
  const context = await fetchReservationMessageContext(reservationId, client);
  if (!context) return null;
  return {
    context,
    text: renderReservationMessage(templateKey, context.reservation, context.branch),
  };
}

/** Fetch every selected reservation from the server for a batch preview/action. */
export async function fetchReservationMessageBatchContexts(
  reservationIds: string[],
  client: SupabaseClient = defaultClient()
): Promise<BatchReservationMessageContext[]> {
  if (reservationIds.length === 0) return [];

  const { data, error } = await client
    .from("reservations")
    .select(
      `id, customer_name, phone, email, start_time, end_time, total_price, guest_count, booking_code, status,
       created_at, is_deposit_paid,
       room:rooms(name, branch:branches(*))`
    )
    .in("id", reservationIds);

  if (error || !data) return [];
  const rowsById = new Map(
    (data as Record<string, unknown>[]).map((row) => [String(row.id), row])
  );

  return reservationIds.flatMap((reservationId) => {
    const row = rowsById.get(reservationId);
    if (!row) return [];
    const room = first(row.room as RoomRow | RoomRow[] | null);
    const branch = first(room?.branch);
    if (!branch?.id) return [];
    return [
      {
        reservationId,
        branchId: branch.id,
        phone: String(row.phone ?? ""),
        email: row.email == null ? null : String(row.email),
        status: row.status == null ? null : String(row.status),
        reservation: {
          customer_name: String(row.customer_name ?? ""),
          start_time: String(row.start_time),
          end_time: String(row.end_time),
          total_price: row.total_price == null ? null : Number(row.total_price),
          guest_count: row.guest_count == null ? null : Number(row.guest_count),
          booking_code: (row.booking_code as string | null | undefined) ?? null,
          created_at: (row.created_at as string | null | undefined) ?? null,
          is_deposit_paid: Boolean(row.is_deposit_paid),
          room_name: room?.name ?? null,
        },
        branch,
      },
    ];
  });
}

export function isValidReservationMessageTemplate(
  value: unknown
): value is ReservationMessageTemplateKey {
  return isReservationMessageTemplateKey(value);
}

export async function recordReservationMessageAction(
  input: {
    reservationId: string;
    templateKey: ReservationMessageTemplateKey;
    channel: ReservationMessageChannel;
    action: ReservationMessageAction;
    actorUserId?: string | null;
    renderedText: string;
    batchId?: string | null;
  },
  client: SupabaseClient = defaultClient()
): Promise<string> {
  const ids = await recordReservationMessageActions([input], client);
  return ids[0];
}

export async function recordReservationMessageActions(
  inputs: Array<{
    reservationId: string;
    templateKey: ReservationMessageTemplateKey;
    channel: ReservationMessageChannel;
    action: ReservationMessageAction;
    actorUserId?: string | null;
    renderedText: string;
    batchId?: string | null;
  }>,
  client: SupabaseClient = defaultClient()
): Promise<string[]> {
  if (inputs.length === 0) return [];
  const { data, error } = await client
    .from("reservation_message_actions")
    .insert(
      inputs.map((input) => ({
        reservation_id: input.reservationId,
        template_key: input.templateKey,
        channel: input.channel,
        action: input.action,
        actor_user_id: input.actorUserId ?? null,
        rendered_text: input.renderedText,
        batch_id: input.batchId ?? null,
      }))
    )
    .select("id")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => String(row.id));
}
