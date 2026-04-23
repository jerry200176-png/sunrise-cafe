import { NextRequest, NextResponse } from "next/server";
import {
    fetchReservationsForReminder,
    fetchTomorrowsReservations,
    updateReservationAdmin,
    isAdminConfigured,
} from "@/lib/supabase-admin";
import {
    sendLineMessage,
    formatReminderMessage,
    isLineConfigured,
} from "@/lib/line-notify";
import { sendLineMessage as sendLineMessageToUser } from "@/lib/line";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";

/**
 * 共用邏輯：查詢明日訂位 → 格式化 → 發送到 LINE 群組 → 標記已通知
 * @param force 如果為 true，則無視 is_notified 狀態全部發送 (用於手動觸發)
 */
const CAT_MESSAGES = [
    "喵～沒訂位！Ivy 妳備好零食了嗎？本喵五分鐘後到 🐱",
    "喵！明日空班。御碩你欠我一罐罐頭，記帳了喔 🐾",
    "明天空班。鄭昇老師你的膝蓋今晚已被本喵預約，請勿臨時取消 ฅ(＾・ω・＾ฅ)",
    "喵嗚～沒訂位。Maggie 妳的零食是我的，妳的外套也是我的，其實妳所有東西都是我的 🐱",
    "明日無訂位。本喵將展開全店巡邏，所有椅子都是我的，不要攔我 🐾",
];

async function handleSendLine(force: boolean = false, sendCatOnEmpty: boolean = false) {
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
        const allRows = await fetchReservationsForReminder(force);

        // 2. 篩選出「大安店」的訂位
        // allRows 的每一筆資料現在應該有 room: { name: '...', branch: { name: '...' } }
        const daanRows = allRows.filter((r: Record<string, unknown>) => {
            const room = r.room as { branch?: { name?: string } } | undefined;
            const branchName = room?.branch?.name || "—";
            return branchName.includes("大安店");
        });

        // 3. 避免 Vercel 逾時重試導致「連發兩次」：若無大安店新訂位，安靜略過
        if (daanRows.length === 0) {
            if (sendCatOnEmpty) {
                // 二次確認：確認明天大安店真的沒有任何訂位（非只是「已通知完」）
                const allTomorrow = await fetchTomorrowsReservations();
                const daanTomorrow = (allTomorrow ?? []).filter((r: Record<string, unknown>) => {
                    const room = r.room as { branch?: { name?: string } } | undefined;
                    return (room?.branch?.name || "").includes("大安店");
                });
                if (daanTomorrow.length === 0) {
                    const msg = CAT_MESSAGES[Math.floor(Math.random() * CAT_MESSAGES.length)];
                    await sendLineMessage(msg);
                    console.log("[send-line] 明日無訂位，已發送貓咪訊息。");
                }
            }
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
                notes: r.notes as string | null | undefined,
            };
        });

        // 5. 轉換文字並發送
        const text = formatReminderMessage(enriched);
        await sendLineMessage(text);

        // 6. 標記為已通知
        await Promise.all(
            daanRows.map((r: Record<string, unknown>) => updateReservationAdmin(r.id as string, { is_notified: true }))
        );

        // 7. 個別傳提醒給有綁定 LINE 的客人（不限大安店，所有明日訂位）
        for (const r of allRows) {
            const lineUserId = (r as Record<string, unknown>).line_user_id as string | null;
            if (!lineUserId) continue;
            try {
                const startDate = parseISO((r as Record<string, unknown>).start_time as string);
                const endDate = parseISO((r as Record<string, unknown>).end_time as string);
                const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
                const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
                const personalText =
                    `您好，這裡是昇昇咖啡！\n\n` +
                    `提醒您明日有訂位：\n` +
                    `📅 ${formattedDate} ${timeRange}\n\n` +
                    `期待您的光臨，如有異動請提早告知，謝謝！`;
                await sendLineMessageToUser(lineUserId, personalText);
            } catch {
                // 個別發送失敗不影響其他人
            }
        }

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
    return handleSendLine(false, true);
}

/** POST: 手動觸發（後台按鈕或 curl） */
export async function POST() {
    return handleSendLine(true);
}
