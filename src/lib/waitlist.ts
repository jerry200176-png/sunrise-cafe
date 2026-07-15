/**
 * Waitlist fan-out after a slot frees (cancel / deposit release / waitlist expiry).
 * Only mark `notified` after a successful guest LINE push — otherwise leave `waiting`
 * so ops can call, or a later release can retry. (Market: inline-style waitlist.)
 *
 * When guest has no LINE bind, push a one-shot staff alert (needs call) then leave waiting.
 */
import { createClient } from "@supabase/supabase-js";
import { sendLineFlexMessage } from "@/lib/line";
import {
  buildWaitlistFlex,
  buildWaitlistNeedsCallGroupFlex,
  WAITLIST_CONFIRM_WINDOW_MINUTES,
} from "@/lib/line-cards";
import { sendLineFlex, sendLineFlexToGroup } from "@/lib/line-notify";

export { WAITLIST_CONFIRM_WINDOW_MINUTES };

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type NotifyWaitlistResult =
  | { outcome: "none" }
  | { outcome: "no_line"; entryId: string; phone: string; staffAlerted?: boolean }
  | { outcome: "line_failed"; entryId: string; phone: string; error: string }
  | { outcome: "notified"; entryId: string; phone: string };

async function alertStaffNeedsCall(entry: {
  id: string;
  customer_name: string;
  phone: string;
  start_time: string;
  end_time: string;
  staff_alerted_at?: string | null;
  room?:
    | {
        name?: string;
        branch?: { name?: string; line_group_id?: string | null } | { name?: string; line_group_id?: string | null }[];
      }
    | {
        name?: string;
        branch?: { name?: string; line_group_id?: string | null } | { name?: string; line_group_id?: string | null }[];
      }[];
}): Promise<boolean> {
  if (entry.staff_alerted_at) return false;

  const room = Array.isArray(entry.room) ? entry.room[0] : entry.room;
  const branchRaw = room?.branch;
  const branch = Array.isArray(branchRaw) ? branchRaw[0] : branchRaw;
  const roomLabel = [branch?.name, room?.name].filter(Boolean).join(" · ") || "包廂";
  const groupId = branch?.line_group_id?.trim() || null;

  const flex = buildWaitlistNeedsCallGroupFlex({
    customerName: entry.customer_name,
    phone: entry.phone,
    roomLabel,
    startTime: entry.start_time,
    endTime: entry.end_time,
  });
  const alt = `等位需電聯：${entry.customer_name} ${entry.phone}`;

  try {
    if (groupId) {
      await sendLineFlexToGroup(alt, flex, groupId);
    } else {
      await sendLineFlex(alt, flex);
    }
  } catch (err) {
    console.error("[waitlist] staff needs-call alert failed:", err);
    return false;
  }

  const { error } = await supabaseAdmin()
    .from("waitlist")
    .update({ staff_alerted_at: new Date().toISOString() })
    .eq("id", entry.id);

  if (error) {
    if (/staff_alerted_at/i.test(error.message)) {
      console.warn("[waitlist] staff_alerted_at column missing; alert sent without stamp");
      return true;
    }
    console.error("[waitlist] failed to stamp staff_alerted_at:", error.message);
    return true; // alert already sent
  }
  return true;
}

export async function notifyWaitlist(
  roomId: string,
  cancelledStart: string,
  cancelledEnd: string
): Promise<NotifyWaitlistResult> {
  const { data: entries } = await supabaseAdmin()
    .from("waitlist")
    .select(
      "id, customer_name, phone, start_time, end_time, confirm_token, staff_alerted_at, room:rooms(name, branch:branches(name, line_group_id))"
    )
    .eq("room_id", roomId)
    .eq("status", "waiting")
    .lt("start_time", cancelledEnd)
    .gt("end_time", cancelledStart)
    .order("created_at", { ascending: true })
    .limit(1);

  let entry = entries?.[0] as
    | {
        id: string;
        customer_name: string;
        phone: string;
        start_time: string;
        end_time: string;
        confirm_token: string;
        staff_alerted_at?: string | null;
        room?:
          | {
              name?: string;
              branch?:
                | { name?: string; line_group_id?: string | null }
                | { name?: string; line_group_id?: string | null }[];
            }
          | {
              name?: string;
              branch?:
                | { name?: string; line_group_id?: string | null }
                | { name?: string; line_group_id?: string | null }[];
            }[];
      }
    | undefined;

  if (!entry) {
    // Column missing → retry without staff_alerted_at / room join
    const fallback = await supabaseAdmin()
      .from("waitlist")
      .select("id, customer_name, phone, start_time, end_time, confirm_token")
      .eq("room_id", roomId)
      .eq("status", "waiting")
      .lt("start_time", cancelledEnd)
      .gt("end_time", cancelledStart)
      .order("created_at", { ascending: true })
      .limit(1);
    entry = fallback.data?.[0] as typeof entry;
  }

  if (!entry) return { outcome: "none" };

  const { data: reservations } = await supabaseAdmin()
    .from("reservations")
    .select("line_user_id")
    .eq("phone", entry.phone)
    .not("line_user_id", "is", null)
    .limit(1);

  const lineUserId = reservations?.[0]?.line_user_id as string | null;

  if (!lineUserId) {
    console.warn(
      `[waitlist] skip mark notified — no LINE bind for phone=${entry.phone}; leave waiting for staff call / retry`
    );
    const staffAlerted = await alertStaffNeedsCall(entry);
    return { outcome: "no_line", entryId: entry.id, phone: entry.phone, staffAlerted };
  }

  try {
    const flex = buildWaitlistFlex({
      startTime: entry.start_time,
      endTime: entry.end_time,
      confirmToken: entry.confirm_token,
    });
    await sendLineFlexMessage(lineUserId, "您等位的時段空出來了！", flex);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[waitlist] LINE 通知失敗，保持 waiting:", detail);
    return { outcome: "line_failed", entryId: entry.id, phone: entry.phone, error: detail };
  }

  await supabaseAdmin()
    .from("waitlist")
    .update({ status: "notified", notified_at: new Date().toISOString() })
    .eq("id", entry.id);

  console.log(`[waitlist] notified phone=${entry.phone}`);
  return { outcome: "notified", entryId: entry.id, phone: entry.phone };
}
