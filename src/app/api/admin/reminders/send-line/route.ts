import { NextRequest, NextResponse } from "next/server";
import {
    fetchReservationsForReminder,
    updateReservationAdmin,
    isAdminConfigured,
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
        // 1. 取得明日待通知訂位 (含 room 與 branch 關聯資料)
        const allRows = await fetchReservationsForReminder();

        // 2. 篩選出「大安店」的訂位
        // allRows 的每一筆資料現在應該有 room: { name: '...', branch: { name: '...' } }
        const daanRows = allRows.filter((r: Record<string, unknown>) => {
            const room = r.room as { branch?: { name?: string } } | undefined;
            const branchName = room?.branch?.name || "—";
            return branchName.includes("大安店");
        });

        // 3. 避免 Vercel 逾時重試導致「連發兩次」：若無大安店新訂位，安靜略過
        if (daanRows.length === 0) {
            console.log("[send-line] 明日大安店無新訂位，略過發送。");
            return NextResponse.json({ ok: true, sent: 0, message: "大安店明日無訂位" });
        }

        // 4. 格式化資料
        const enriched = daanRows.map((r: Record<string, unknown>) => {
            const room = r.room as { name?: string; branch?: { name?: string } } | undefined;
            return {
                booking_code: r.booking_code as string,
                room_name: room?.name ?? "—",
                branch_name: room?.branch?.name ?? "—",
                start_time: r.start_time as string,
                end_time: r.end_time as string,
                customer_name: r.customer_name as string,
                phone: r.phone as string,
                guest_count: r.guest_count as number | null | undefined,
            };
        });

        // 5. 轉換文字並發送
        const text = formatReminderMessage(enriched);
        await sendLineMessage(text);

        // 6. 標記為已通知
        await Promise.all(
            daanRows.map((r: Record<string, unknown>) => updateReservationAdmin(r.id as string, { is_notified: true }))
        );

        return NextResponse.json({ ok: true, sent: daanRows.length });
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
