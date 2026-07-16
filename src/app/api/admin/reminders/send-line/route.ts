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
    sendLineFlexToGroup,
    sendLineFlex,
    buildReminderDigestFlexChunks,
    isLineConfigured,
} from "@/lib/line-notify";
import { sendLineFlexMessage, buildReminderFlex } from "@/lib/line";
import { runCronJob } from "@/lib/job-runs";
import { errorToDetail } from "@/lib/cron-alert";
import { authorizeCronGet } from "@/lib/cron-request-auth";
import { reservationMatchesBranch, type ReminderReservationShape } from "@/lib/reminder-branch-match";
import { signAttendanceToken } from "@/lib/attendance-token";
import { LINE_SITE_URL } from "@/lib/line-flex";

const CAT_MESSAGES = [
    "喵～沒訂位！Ivy 妳備好零食了嗎？本喵五分鐘後到 🐱",
    "喵！明日空班。御碩你欠我一罐罐頭，記帳了喔 🐾",
    "明天空班。鄭昇老師你的膝蓋今晚已被本喵預約，請勿臨時取消 ฅ(＾・ω・＾ฅ)",
    "喵嗚～沒訂位。Maggie 妳的零食是我的，妳的外套也是我的，其實妳所有東西都是我的 🐱",
    "明日無訂位。本喵將展開全店巡邏，所有椅子都是我的，不要攔我 🐾",
];

type BranchRow = { id: string; name: string; line_group_id?: string | null };

async function pushDigestToGroup(
    rows: Record<string, unknown>[],
    groupId: string | null,
    labelPrefix: string
) {
    const enriched = rows.map(toEnriched);
    const chunks = buildReminderDigestFlexChunks(enriched);
    for (let i = 0; i < chunks.length; i++) {
        const part =
            chunks.length > 1 ? `（${i + 1}/${chunks.length}）` : "";
        const alt = `${labelPrefix}，共 ${rows.length} 筆${part}`;
        if (groupId) {
            await sendLineFlexToGroup(alt, chunks[i]!, groupId);
        } else {
            await sendLineFlex(alt, chunks[i]!);
        }
    }
}

/** Cron-only: avoid total silence when tomorrow bookings exist but all already notified. */
function alreadyNotifiedCronMessage(count: number): string {
    const when = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
    return `📅 明日訂位提醒已執行\n共 ${count} 筆訂位，皆已通知過（無需重送）\n時間：${when}`;
}

async function pushTextToGroups(
    text: string,
    activeBranches: BranchRow[],
    useLegacyMode: boolean
) {
    if (useLegacyMode) {
        await sendLineMessage(text);
        return;
    }
    await Promise.all(
        activeBranches.map((branch) =>
            sendLineMessageToGroup(text, branch.line_group_id!).catch((e) =>
                console.error(`[send-line] status msg failed for branch ${branch.name}:`, e)
            )
        )
    );
}

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
                    const tomorrowCount = (allTomorrow ?? []).length;
                    if (tomorrowCount === 0) {
                        await sendLineMessage(CAT_MESSAGES[Math.floor(Math.random() * CAT_MESSAGES.length)]);
                    } else {
                        // Previously silent when all is_notified=true — staff thought cron died
                        await pushTextToGroups(
                            alreadyNotifiedCronMessage(tomorrowCount),
                            activeBranches,
                            true
                        );
                    }
                }
                return NextResponse.json({
                    ok: true,
                    sent: 0,
                    message: "沒有尚未通知的明日訂位（可能已全部發送過）",
                });
            }
            await pushDigestToGroup(rows, null, "📅 明日訂位提醒");
            await Promise.all(rows.map((r) => updateReservationAdmin(r.id as string, { is_notified: true })));
            totalSent = rows.length;
        } else {
            // ── 多分店模式（資料庫 line_group_id）──────────────────────
            const matchedIds = new Set<string>();

            // Prefetch tomorrow set once for empty-branch cat / already-notified status
            const allTomorrow = sendCatOnEmpty ? await fetchTomorrowsReservations() : null;

            for (const branch of activeBranches) {
                const groupId = branch.line_group_id!;
                const branchRows = (allRows as Record<string, unknown>[]).filter((r) =>
                    reservationMatchesBranch(r as ReminderReservationShape, branch)
                );

                if (branchRows.length === 0) {
                    if (sendCatOnEmpty && allTomorrow) {
                        const branchTomorrow = allTomorrow.filter((r: Record<string, unknown>) =>
                            reservationMatchesBranch(r as ReminderReservationShape, branch)
                        );
                        if (branchTomorrow.length === 0) {
                            const msg = CAT_MESSAGES[Math.floor(Math.random() * CAT_MESSAGES.length)];
                            await sendLineMessageToGroup(msg, groupId).catch((e) =>
                                console.error(`[send-line] cat msg failed for branch ${branch.name}:`, e)
                            );
                        } else {
                            await sendLineMessageToGroup(
                                alreadyNotifiedCronMessage(branchTomorrow.length),
                                groupId
                            ).catch((e) =>
                                console.error(`[send-line] status msg failed for branch ${branch.name}:`, e)
                            );
                        }
                    }
                    continue;
                }

                await pushDigestToGroup(branchRows, groupId, "📅 明日訂位提醒");
                await Promise.all(
                    branchRows.map((r) => updateReservationAdmin(r.id as string, { is_notified: true }))
                );
                for (const r of branchRows) matchedIds.add(r.id as string);
                totalSent += branchRows.length;
            }

            // 未綁 line_group_id 的分店訂位 → fallback 環境變數群組，避免永遠不標 is_notified、客人個人訊息每夜重送
            const unmatched = (allRows as Record<string, unknown>[]).filter(
                (r) => !matchedIds.has(r.id as string)
            );
            if (unmatched.length > 0) {
                if (isLineConfigured()) {
                    await pushDigestToGroup(unmatched, null, "📅 明日訂位提醒（未設定分店群組）");
                    await Promise.all(
                        unmatched.map((r) => updateReservationAdmin(r.id as string, { is_notified: true }))
                    );
                    totalSent += unmatched.length;
                    console.warn(
                        `[send-line] multi-branch: ${unmatched.length} row(s) fell back to LINE_GROUP_ID`
                    );
                } else {
                    console.error(
                        `[send-line] multi-branch: ${unmatched.length} pending tomorrow reservation(s) matched no line_group_id and LINE_GROUP_ID unset`
                    );
                }
            }
        }

        // 3. 個別傳提醒給有綁定 LINE 的客人（所有分店）— 含 D-1 確認準時 CTA
        for (const r of allRows as Record<string, unknown>[]) {
            const lineUserId = r.line_user_id as string | null;
            if (!lineUserId) continue;
            try {
                const room = r.room as { name?: string; branch?: { name?: string } } | undefined;
                const reservationId = r.id as string;
                const bookingCode = (r.booking_code as string | null) ?? null;
                const confirmAttendanceUrl = reservationId
                    ? `${LINE_SITE_URL}/book/confirm-visit?token=${encodeURIComponent(signAttendanceToken(reservationId))}`
                    : null;
                const flex = buildReminderFlex({
                    leadLabel: "明日",
                    branchName: room?.branch?.name ?? "昇昇咖啡",
                    roomName: room?.name ?? null,
                    startTime: r.start_time as string,
                    endTime: r.end_time as string,
                    bookingCode,
                    confirmAttendanceUrl,
                });
                await sendLineFlexMessage(lineUserId, "明日訂位提醒", flex);
            } catch {
                // 個別發送失敗不影響其他人
            }
        }

        return NextResponse.json({
            ok: true,
            sent: totalSent,
            message:
                totalSent === 0
                    ? "沒有尚未通知的明日訂位（可能已全部發送過）"
                    : `已發送 ${totalSent} 筆明日提醒（僅尚未通知的訂位）`,
        });
    } catch (err) {
        const message = errorToDetail(err);
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
    const cronAuth = authorizeCronGet(request);
    if (!cronAuth.ok) return cronAuth.response;
    return runCronJob("send-line", () => handleSendLine(false, true));
}

export async function POST() {
    return runCronJob("send-line", () => handleSendLine(false));
}
