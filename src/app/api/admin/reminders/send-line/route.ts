import { NextRequest, NextResponse } from "next/server";
import {
    fetchReservationsForReminder,
    updateReservationAdmin,
    isAdminConfigured,
    fetchRoom,
    fetchBranch,
} from "@/lib/supabase-admin";
import {
    sendLineMessage,
    formatReminderMessage,
    isLineConfigured,
} from "@/lib/line-notify";

/**
 * 共用邏輯：查詢明日訂位 → 格式化 → 發送到 LINE 群組 → 標記已通知
 */
async function handleSendLine() {
    if (!isAdminConfigured()) {
        return NextResponse.json(
            { error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" },
            { status: 503 }
        );
    }
    if (!isLineConfigured()) {
        return NextResponse.json(
            { error: "未設定 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_GROUP_ID，請至 .env.local 設定" },
            { status: 503 }
        );
    }

    try {
        // 1. 取得明日待通知訂位
        const rows = await fetchReservationsForReminder();

        if (rows.length === 0) {
            await sendLineMessage("📋 明日無訂位，不需準備包廂。");
            return NextResponse.json({ ok: true, sent: 0, message: "明日無訂位" });
        }

        // 2. 補上 room / branch 名稱
        const enriched = await Promise.all(
            rows.map(async (r) => {
                const room = await fetchRoom(r.room_id);
                const branch = room?.branch_id
                    ? await fetchBranch(room.branch_id)
                    : null;
                return {
                    booking_code: r.booking_code,
                    room_name: room?.name ?? "—",
                    branch_name: branch?.name ?? "—",
                    start_time: r.start_time,
                    end_time: r.end_time,
                    customer_name: r.customer_name,
                    phone: r.phone,
                    guest_count: (r as Record<string, unknown>).guest_count as number | null | undefined,
                };
            })
        );

        // 3. 格式化並發送
        const text = formatReminderMessage(enriched);
        await sendLineMessage(text);

        // 4. 標記已通知
        await Promise.all(
            rows.map((r) => updateReservationAdmin(r.id, { is_notified: true }))
        );

        return NextResponse.json({ ok: true, sent: rows.length });
    } catch (err) {
        const message = err instanceof Error ? err.message : "LINE 發送失敗";
        console.error("[send-line] Error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

/**
 * GET: Vercel Cron Job 觸發入口
 * Vercel Cron 會帶上 Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    }
    return handleSendLine();
}

/** POST: 手動觸發（後台按鈕或 curl） */
export async function POST() {
    return handleSendLine();
}
