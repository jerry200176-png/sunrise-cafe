import { NextRequest, NextResponse } from "next/server";
import {
    fetchReservationsForReminder,
    fetchTomorrowsReservations,
    fetchBranches,
    updateReservationAdmin,
    isAdminConfigured,
} from "@/lib/supabase-admin";
import {
    sendLineMessageToGroup,
    sendLineMessage,
    formatReminderMessage,
    isLineConfigured,
} from "@/lib/line-notify";
import { sendLineMessage as sendLineMessageToUser } from "@/lib/line";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";

const CAT_MESSAGES = [
    "喵～沒訂位！Ivy 妳備好零食了嗎？本喵五分鐘後到 🐱",
    "喵！明日空班。御碩你欠我一罐罐頭，記帳了喔 🐾",
    "明天空班。鄭昇老師你的膝蓋今晚已被本喵預約，請勿臨時取消 ฅ(＾・ω・＾ฅ)",
    "喵嗚～沒訂位。Maggie 妳的零食是我的，妳的外套也是我的，其實妳所有東西都是我的 🐱",
    "明日無訂位。本喵將展開全店巡邏，所有椅子都是我的，不要攔我 🐾",
];

type BranchRow = { id: string; name: string; line_group_id?: string | null };

async function handleSendLine(force: boolean = false, sendCatOnEmpty: boolean = false) {
    if (!isAdminConfigured()) {
        return NextResponse.json({ error: "後端未設定 SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
    }

    try {
        // 1. 取得所有分店，找出有設定 line_group_id 的
        const branches = (await fetchBranches()) as BranchRow[];
        const activeBranches = branches.filter((b) => b.line_group_id);

        // 向下相容：若沒有任何分店設定 line_group_id，使用環境變數模式
        const useLegacyMode = activeBranches.length === 0;

        // 2. 取得明日待通知訂位
        const allRows = await fetchReservationsForReminder(force);
        let totalSent = 0;

        if (useLegacyMode) {
            // ── Legacy 模式（環境變數 LINE_GROUP_ID）────────────────────
            if (!isLineConfigured()) {
                return NextResponse.json(
                    { error: "未設定 LINE_CHANNEL_ACCESS_TOKEN 或 LINE_GROUP_ID，請至 .env.local 設定" },
                    { status: 503 }
                );
            }
            const rows = allRows as Record<string, unknown>[];
            if (rows.length === 0) {
                if (sendCatOnEmpty) {
                    const allTomorrow = await fetchTomorrowsReservations();
                    if ((allTomorrow ?? []).length === 0) {
                        await sendLineMessage(CAT_MESSAGES[Math.floor(Math.random() * CAT_MESSAGES.length)]);
                    }
                }
                return NextResponse.json({ ok: true, sent: 0 });
            }
            const text = formatReminderMessage(rows.map(toEnriched));
            await sendLineMessage(text);
            await Promise.all(rows.map((r) => updateReservationAdmin(r.id as string, { is_notified: true })));
            totalSent = rows.length;
        } else {
            // ── 多分店模式（資料庫 line_group_id）──────────────────────
            for (const branch of activeBranches) {
                const groupId = branch.line_group_id!;
                const branchRows = (allRows as Record<string, unknown>[]).filter((r) => {
                    const room = r.room as { branch?: { id?: string } } | undefined;
                    return room?.branch?.id === branch.id || (r as Record<string, unknown>).branch_id === branch.id;
                });

                if (branchRows.length === 0) {
                    if (sendCatOnEmpty) {
                        const allTomorrow = await fetchTomorrowsReservations();
                        const branchTomorrow = (allTomorrow ?? []).filter((r: Record<string, unknown>) => {
                            const room = r.room as { branch?: { id?: string } } | undefined;
                            return room?.branch?.id === branch.id;
                        });
                        if (branchTomorrow.length === 0) {
                            const msg = CAT_MESSAGES[Math.floor(Math.random() * CAT_MESSAGES.length)];
                            await sendLineMessageToGroup(msg, groupId).catch((e) =>
                                console.error(`[send-line] cat msg failed for branch ${branch.name}:`, e)
                            );
                        }
                    }
                    continue;
                }

                const text = formatReminderMessage(branchRows.map(toEnriched));
                await sendLineMessageToGroup(text, groupId);
                await Promise.all(
                    branchRows.map((r) => updateReservationAdmin(r.id as string, { is_notified: true }))
                );
                totalSent += branchRows.length;
            }
        }

        // 3. 個別傳提醒給有綁定 LINE 的客人（所有分店）
        for (const r of allRows as Record<string, unknown>[]) {
            const lineUserId = r.line_user_id as string | null;
            if (!lineUserId) continue;
            try {
                const startDate = parseISO(r.start_time as string);
                const endDate = parseISO(r.end_time as string);
                const formattedDate = format(startDate, "yyyy/MM/dd (EEE)", { locale: zhTW });
                const timeRange = `${format(startDate, "HH:mm")}–${format(endDate, "HH:mm")}`;
                await sendLineMessageToUser(
                    lineUserId,
                    `您好，這裡是昇昇咖啡！\n\n提醒您明日有訂位：\n📅 ${formattedDate} ${timeRange}\n\n期待您的光臨，如有異動請提早告知，謝謝！`
                );
            } catch {
                // 個別發送失敗不影響其他人
            }
        }

        return NextResponse.json({ ok: true, sent: totalSent });
    } catch (err) {
        const message = err instanceof Error ? err.message : "LINE 發送失敗";
        console.error("[send-line] Error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

function toEnriched(r: Record<string, unknown>) {
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
}

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

export async function POST() {
    return handleSendLine(true);
}
