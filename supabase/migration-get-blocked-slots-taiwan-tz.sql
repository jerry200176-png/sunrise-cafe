-- 修正 get_blocked_slots：以台灣時區 (Asia/Taipei) 解讀 p_date
-- 在 Supabase Dashboard → SQL Editor 執行

CREATE OR REPLACE FUNCTION get_blocked_slots(p_branch_id UUID, p_date DATE)
RETURNS TABLE(room_id UUID, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH day_bounds AS (
    SELECT
      (p_date::timestamp AT TIME ZONE 'Asia/Taipei')::timestamptz AS start_of_day_utc,
      ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Taipei')::timestamptz AS end_of_day_utc
  )
  SELECT r.room_id, r.start_time, r.end_time
  FROM reservations r
  JOIN rooms rm ON rm.id = r.room_id AND rm.branch_id = p_branch_id
  CROSS JOIN day_bounds d
  WHERE r.status NOT IN ('cancelled')
    AND r.start_time < d.end_of_day_utc
    AND r.end_time > d.start_of_day_utc;
$$;

COMMENT ON FUNCTION get_blocked_slots(UUID, DATE) IS '回傳該分店指定「台灣日」內已被預訂的時段（Asia/Taipei 解讀 p_date）';
