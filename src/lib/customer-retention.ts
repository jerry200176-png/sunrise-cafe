/**
 * Customer retention opportunities — privacy-safe aggregates for admin campaigns.
 */
import { normalizePhone } from "@/lib/phone-utils";

export type ReservationLite = {
  id: string;
  phone: string;
  customer_name: string;
  status: string;
  start_time: string;
  created_at: string;
  line_user_id?: string | null;
  review_invited_at?: string | null;
};

function maskPhone(phone: string): string {
  const p = phone.trim();
  if (p.length < 6) return "***";
  return `${p.slice(0, 4)}***${p.slice(-3)}`;
}

export function findInactiveCustomers(
  reservations: ReservationLite[],
  inactiveDays = 90,
  now = new Date()
): { phone_masked: string; last_booking: string; booking_count: number; line_bound: boolean }[] {
  const byPhone = new Map<string, ReservationLite[]>();
  for (const r of reservations) {
    const phone = normalizePhone(r.phone);
    if (!phone) continue;
    const list = byPhone.get(phone) ?? [];
    list.push(r);
    byPhone.set(phone, list);
  }

  const cutoff = now.getTime() - inactiveDays * 24 * 60 * 60 * 1000;
  const results: {
    phone_masked: string;
    last_booking: string;
    booking_count: number;
    line_bound: boolean;
  }[] = [];

  for (const [phone, list] of byPhone) {
    const sorted = [...list].sort(
      (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    );
    const last = sorted[0];
    if (new Date(last.start_time).getTime() > cutoff) continue;
    if (list.length < 1) continue;
    results.push({
      phone_masked: maskPhone(phone),
      last_booking: last.start_time,
      booking_count: list.length,
      line_bound: list.some((r) => r.line_user_id),
    });
  }

  return results.sort(
    (a, b) => new Date(a.last_booking).getTime() - new Date(b.last_booking).getTime()
  );
}

export function findReviewInviteCandidates(
  reservations: ReservationLite[]
): { id: string; customer_name: string; start_time: string; line_bound: boolean }[] {
  return reservations
    .filter(
      (r) =>
        r.status === "completed" &&
        !r.review_invited_at &&
        r.line_user_id
    )
    .map((r) => ({
      id: r.id,
      customer_name: r.customer_name,
      start_time: r.start_time,
      line_bound: Boolean(r.line_user_id),
    }));
}

/** First booking anniversary in the next N days (by month/day of first created_at) */
export function findAnniversaryOpportunities(
  reservations: ReservationLite[],
  withinDays = 14,
  now = new Date()
): { phone_masked: string; anniversary_date: string; years: number; line_bound: boolean }[] {
  const byPhone = new Map<string, ReservationLite[]>();
  for (const r of reservations) {
    const phone = normalizePhone(r.phone);
    if (!phone) continue;
    const list = byPhone.get(phone) ?? [];
    list.push(r);
    byPhone.set(phone, list);
  }

  const out: {
    phone_masked: string;
    anniversary_date: string;
    years: number;
    line_bound: boolean;
  }[] = [];

  for (const [phone, list] of byPhone) {
    const first = [...list].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )[0];
    const created = new Date(first.created_at);
    const thisYear = new Date(
      now.getFullYear(),
      created.getMonth(),
      created.getDate()
    );
    const diffDays = (thisYear.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    if (diffDays < 0 || diffDays > withinDays) continue;
    const years = now.getFullYear() - created.getFullYear();
    if (years < 1) continue;
    out.push({
      phone_masked: maskPhone(phone),
      anniversary_date: thisYear.toISOString().slice(0, 10),
      years,
      line_bound: list.some((r) => r.line_user_id),
    });
  }

  return out;
}
