import type { SupabaseClient } from "@supabase/supabase-js";

type BranchEmbed = { line_group_id?: string | null } | { line_group_id?: string | null }[] | null | undefined;
type RoomEmbed = { branch?: BranchEmbed } | { branch?: BranchEmbed }[] | null | undefined;

function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

function groupIdOf(room: RoomEmbed): string | null {
  return one(one(room)?.branch)?.line_group_id?.trim() || null;
}

/**
 * LINE group of the branch that owns a room / reservation. Never throws: any lookup
 * problem returns null so notifications fall back to the default group.
 */
export async function branchLineGroupIdForRoom(db: SupabaseClient, roomId: string): Promise<string | null> {
  try {
    const { data } = await db.from("rooms").select("branch:branches(line_group_id)").eq("id", roomId).maybeSingle();
    return groupIdOf(data as RoomEmbed);
  } catch {
    return null;
  }
}

export async function branchLineGroupIdForReservation(db: SupabaseClient, reservationId: string): Promise<string | null> {
  try {
    const { data } = await db
      .from("reservations")
      .select("room:rooms(branch:branches(line_group_id))")
      .eq("id", reservationId)
      .maybeSingle();
    return groupIdOf((data as { room?: RoomEmbed } | null)?.room);
  } catch {
    return null;
  }
}
