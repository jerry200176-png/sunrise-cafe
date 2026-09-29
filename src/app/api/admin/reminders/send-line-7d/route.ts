import { NextRequest, NextResponse } from "next/server";
import {
  fetchReservationsIn7Days,
  updateReservationAdmin,
  isAdminConfigured,
} from "@/lib/supabase-admin";
import { sendLineFlexMessage } from "@/lib/line";
import {
  buildGuestReminderDigestFlexChunks,
  REMINDER_DIGEST_CAROUSEL_MAX,
} from "@/lib/line-cards";
import { runCronJob } from "@/lib/job-runs";
import { authorizeCronGet } from "@/lib/cron-request-auth";
import { errorToDetail } from "@/lib/cron-alert";
import { runBootstrapMigrations } from "@/lib/bootstrap-migrations";
import {
  claimLineReminderDelivery,
  markLineReminderDelivery,
  safeLineDeliveryError,
} from "@/lib/line-delivery";
import { taipeiDateString } from "@/lib/datetime";

async function handleSend() {
  await runBootstrapMigrations();
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  try {
    const rows = await fetchReservationsIn7Days();
    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        message_count: 0,
        recipient_count: 0,
        accepted_count: 0,
        rejected_count: 0,
        result: "already_notified",
        message: "無需提醒的訂位",
      });
    }

    let sent = 0;
    let errors = 0;
    // One digest per guest per store: each store's own LINE account sends its bookings.
    const byUser = new Map<string, typeof rows>();
    for (const row of rows) {
      const room = row.room as { branch_id?: string; branch?: { id?: string; name?: string } } | undefined;
      const branch = room?.branch_id ?? room?.branch?.id ?? room?.branch?.name ?? "";
      const key = `${String(row.line_user_id)}\u0000${branch}`;
      byUser.set(key, [...(byUser.get(key) ?? []), row]);
    }

    for (const userRows of byUser.values()) {
      const lineUserId = String(userRows[0]!.line_user_id);
      for (let offset = 0; offset < userRows.length; offset += REMINDER_DIGEST_CAROUSEL_MAX) {
        const rowChunk = userRows.slice(offset, offset + REMINDER_DIGEST_CAROUSEL_MAX);
        const claims: { row: (typeof rows)[number]; id: string | null }[] = [];
        for (const row of rowChunk) {
          const claim = await claimLineReminderDelivery({
            reminderType: "d7_guest",
            reminderDate: taipeiDateString(new Date(row.start_time as string)),
            reservationId: String(row.id),
            recipientType: "guest",
            recipientId: lineUserId,
          });
          if (!claim.available || claim.id) claims.push({ row, id: claim.id });
        }
        if (claims.length === 0) continue;

        let lineAccepted = false;
        try {
          const flexRows = claims.map(({ row }) => {
            const room = row.room as { name?: string; branch?: { name?: string } } | undefined;
            return {
              leadLabel: "7 天後",
              branchName: room?.branch?.name ?? "昇昇咖啡",
              roomName: room?.name ?? null,
              startTime: row.start_time as string,
              endTime: row.end_time as string,
              bookingCode: (row.booking_code as string | null) ?? null,
            };
          });
          const [flex] = buildGuestReminderDigestFlexChunks(flexRows);
          const part = userRows.length > REMINDER_DIGEST_CAROUSEL_MAX
            ? `（${Math.floor(offset / REMINDER_DIGEST_CAROUSEL_MAX) + 1}/${Math.ceil(userRows.length / REMINDER_DIGEST_CAROUSEL_MAX)}）`
            : "";
          await sendLineFlexMessage(lineUserId, `7 天後訂位提醒${part}`, flex!, { reservationId: String(claims[0]!.row.id) });
          lineAccepted = true;
          sent++;
          await Promise.all(
            claims.filter(({ id }) => id).map(({ id }) =>
              markLineReminderDelivery(id!, { status: "sent" })
            )
          );
          await Promise.all(
            claims.map(({ row }) =>
              updateReservationAdmin(String(row.id), { is_reminded_7d: true })
            )
          );
        } catch (err) {
          errors++;
          if (!lineAccepted) {
            await Promise.all(
              claims.filter(({ id }) => id).map(({ id }) =>
                markLineReminderDelivery(id!, {
                  status: "failed",
                  error: safeLineDeliveryError(err),
                })
              )
            );
          }
          console.error(`[send-line-7d] 摘要傳送失敗: ${safeLineDeliveryError(err)}`);
        }
      }
    }

    return NextResponse.json({
      ok: errors === 0,
      sent,
      message_count: sent,
      recipient_count: byUser.size,
      accepted_count: sent,
      rejected_count: errors,
      errors,
      result: errors > 0 && sent > 0 ? "partial" : errors > 0 ? "error" : sent > 0 ? "sent" : "already_notified",
    });
  } catch (err) {
    return NextResponse.json({ error: errorToDetail(err) }, { status: 500 });
  }
}

/** GET: Vercel Cron 觸發 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronGet(request);
  if (!cronAuth.ok) return cronAuth.response;
  return runCronJob("send-line-7d", () => handleSend());
}

/** POST: 手動觸發 */
export async function POST() {
  return runCronJob("send-line-7d", () => handleSend());
}
