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

/** Branch that owns a reservation (null on any lookup problem). */
export async function branchIdForReservation(db: SupabaseClient, reservationId: string): Promise<string | null> {
  try {
    const { data } = await db.from("reservations").select("room:rooms(branch_id)").eq("id", reservationId).maybeSingle();
    return one((data as { room?: { branch_id?: string | null } | { branch_id?: string | null }[] | null } | null)?.room)?.branch_id ?? null;
  } catch {
    return null;
  }
}

/** Branch that owns a room (null on any lookup problem). */
export async function branchIdForRoom(db: SupabaseClient, roomId: string): Promise<string | null> {
  try {
    const { data } = await db.from("rooms").select("branch_id").eq("id", roomId).maybeSingle();
    return (data as { branch_id?: string | null } | null)?.branch_id ?? null;
  } catch {
    return null;
  }
}
