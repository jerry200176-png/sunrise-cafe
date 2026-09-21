#!/usr/bin/env node
/**
 * Bounded incident probe. Database access is SELECT-only and LINE access is
 * limited to GET /v2/bot/info; this script never sends a message or mutates
 * production data.
 */
import crypto from "node:crypto";
import postgres from "postgres";

const connection = process.env.SUPABASE_DB_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!connection || /\[(ref|region)\]|<[^>]+>/i.test(connection)) {
  throw new Error("A usable read-only production Postgres URL is required");
}

const sql = postgres(connection, {
  max: 1,
  idle_timeout: 10,
  connect_timeout: 10,
  ssl: "require",
  prepare: false,
});

const fingerprint = (value) => value ? crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : null;
const relationExists = async (name) => {
  const rows = await sql`SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS present`;
  return rows[0]?.present === true;
};

async function botInfo(token) {
  if (!token) return { token_present: false, http_status: null };
  const response = await fetch("https://api.line.me/v2/bot/info", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { token_present: true, http_status: response.status };
}

try {
  const reservations = await sql`
    SELECT r.id, r.booking_code, r.status, r.start_time, r.end_time,
           r.total_price, r.is_deposit_paid, r.line_user_id,
           r.payment_request_sent_at, r.deposit_approved_notified_at,
           r.deposit_approved_claim_at, r.deposit_approved_retry_key,
           r.deposit_approved_guest_retry_key, r.deposit_approved_retry_key_created_at,
           r.created_at, rm.name AS room_name, b.name AS branch_name
      FROM public.reservations r
      LEFT JOIN public.rooms rm ON rm.id = r.room_id
      LEFT JOIN public.branches b ON b.id = rm.branch_id
     WHERE r.created_at >= now() - interval '72 hours'
     ORDER BY r.created_at DESC
     LIMIT 50`;

  const reservationIds = reservations.map((row) => row.id);
  const events = reservationIds.length === 0 ? [] : await sql`
    SELECT id, ts, domain, action,
           detail->>'reservation_id' AS reservation_id,
           detail->>'provider_status' AS provider_status,
           detail->>'accepted_by_platform' AS accepted_by_platform,
           detail->>'guest_notified' AS guest_notified,
           detail->>'group_notified' AS group_notified,
           detail->>'error' AS error,
           detail->>'outcome' AS outcome
      FROM public.ops_events
     WHERE detail->>'reservation_id' = ANY(${sql.array(reservationIds, "text")})
       AND (action LIKE 'payment.%' OR action LIKE 'line.%')
     ORDER BY ts DESC
     LIMIT 500`;

  const paymentEvents = await relationExists("payment_events")
    ? await sql`
        SELECT id, reservation_id, source, status, created_at, reviewed_at,
               review_note IS NOT NULL AS has_review_note
          FROM public.payment_events
         WHERE reservation_id = ANY(${sql.array(reservationIds, "uuid")})
         ORDER BY created_at DESC
         LIMIT 200`
    : [];

  const lineEvents = events.map((event) => ({
    id: fingerprint(event.id),
    ts: event.ts,
    domain: event.domain,
    action: event.action,
    reservation_fingerprint: fingerprint(event.reservation_id),
    provider_status: event.provider_status ? Number(event.provider_status) : null,
    accepted_by_platform: event.accepted_by_platform === "true",
    guest_notified: event.guest_notified === "true",
    group_notified: event.group_notified === "true",
    outcome: event.outcome,
    error_present: Boolean(event.error),
  }));

  const customerToken = process.env.LINE_CUSTOMER_ACCESS_TOKEN;
  const groupToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const config = {
    customer_token: await botInfo(customerToken),
    group_token: await botInfo(groupToken),
    customer_endpoint: "https://api.line.me/v2/bot/message/push",
    group_endpoint: "https://api.line.me/v2/bot/message/push",
    group_id_present: Boolean(process.env.LINE_GROUP_ID),
    supabase_url_present: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  };

  console.log(JSON.stringify({
    mode: "incident-line-readonly",
    captured_at: new Date().toISOString(),
    database: { query_mode: "SELECT-only", reservation_window_hours: 72 },
    production_config: config,
    reservations: reservations.map((row) => ({
      id_fingerprint: fingerprint(row.id),
      booking_code_fingerprint: fingerprint(row.booking_code),
      status: row.status,
      start_time: row.start_time,
      end_time: row.end_time,
      total_price: row.total_price,
      is_deposit_paid: row.is_deposit_paid,
      line_user_id_present: Boolean(row.line_user_id),
      line_user_id_fingerprint: fingerprint(row.line_user_id),
      payment_request_sent_at: row.payment_request_sent_at,
      deposit_approved_notified_at: row.deposit_approved_notified_at,
      deposit_approved_claim_at: row.deposit_approved_claim_at,
      group_retry_key_present: Boolean(row.deposit_approved_retry_key),
      guest_retry_key_present: Boolean(row.deposit_approved_guest_retry_key),
      retry_key_created_at: row.deposit_approved_retry_key_created_at,
      created_at: row.created_at,
      room: row.room_name,
      branch: row.branch_name,
    })),
    payment_events: paymentEvents.map((event) => ({
      id_fingerprint: fingerprint(event.id),
      reservation_fingerprint: fingerprint(event.reservation_id),
      source: event.source,
      status: event.status,
      created_at: event.created_at,
      reviewed_at: event.reviewed_at,
      has_review_note: event.has_review_note,
    })),
    line_events: lineEvents,
  }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
