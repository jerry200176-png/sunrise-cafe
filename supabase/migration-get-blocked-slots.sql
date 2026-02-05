-- Phase 1: Postgres 函式 get_blocked_slots（僅回傳已佔用時段，不含個資）
-- 在 Supabase Dashboard → SQL Editor 執行

CREATE OR REPLACE FUNCTION get_blocked_slots(p_branch_id UUID, p_date DATE)
RETURNS TABLE(room_id UUID, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.room_id, r.start_time, r.end_time
  FROM reservations r
  JOIN rooms rm ON rm.id = r.room_id AND rm.branch_id = p_branch_id
  WHERE r.status NOT IN ('cancelled')
    AND r.start_time < ((p_date + 1)::timestamp AT TIME ZONE 'UTC')
    AND r.end_time > (p_date::timestamp AT TIME ZONE 'UTC');
$$;

COMMENT ON FUNCTION get_blocked_slots(UUID, DATE) IS '回傳該分店指定日期內已被預訂的時段（僅 room_id, start_time, end_time），供 API 計算可預約時段，不暴露個資';
