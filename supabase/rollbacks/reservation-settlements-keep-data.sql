-- 回滾 #444 結帳／退款函式，保留所有資料。說明與驗證：docs/plans/2026-10-15-refund-rollback.md
-- ⚠️ 只在 Founder 決定回滾時執行；執行前先做備份（scripts/backup-db.sh）。
--
-- 拿掉：會寫入的 RPC（結帳、延長、退款請求、退款狀態、Stripe 同步）與 reservation_billing_state（API 用它判斷新流程可用）→ API 偵測到函式不存在，自動退回舊流程。
-- 保留：reservation_settlements、reservation_extensions、reservation_refunds、reservation_refund_events
--       四張表與其中所有資料、append-only trigger、reservation_refund_current view、唯讀輔助函式、schema_migrations 那一列。
-- 不佔時段規則（no_show 釋出時段）：只有在沒有重疊時才換回舊規則；有重疊就保留新規則並印出提示。
BEGIN;

DROP FUNCTION IF EXISTS public.reservation_billing_state(uuid);
DROP FUNCTION IF EXISTS public.sync_provider_refund(uuid, uuid, text, integer, text);
DROP FUNCTION IF EXISTS public.record_reservation_refund_status(uuid, text, text, text, text, text, uuid[]);
DROP FUNCTION IF EXISTS public.request_reservation_refund(uuid, text, integer, text, text, text, text, text, uuid[]);
DROP FUNCTION IF EXISTS public.settle_reservation_checkout(uuid, integer, integer, text, integer, integer, text, text, text, uuid[]);
DROP FUNCTION IF EXISTS public.extend_reservation_stay(uuid, timestamptz, timestamptz, text);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM reservations a JOIN reservations b
      ON a.room_id = b.room_id AND a.id < b.id
     WHERE a.status IS DISTINCT FROM 'cancelled' AND b.status IS DISTINCT FROM 'cancelled'
       AND a.start_time < b.end_time AND a.end_time > b.start_time
  ) THEN
    RAISE NOTICE 'no_show 和其他組有重疊：保留 reservations_no_overlap_active_excl（no_show 不佔時段）';
  ELSE
    ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_no_overlap_excl;
    ALTER TABLE reservations ADD CONSTRAINT reservations_no_overlap_excl
      EXCLUDE USING gist (room_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&)
      WHERE (status IS DISTINCT FROM 'cancelled');
    ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_no_overlap_active_excl;
  END IF;
END $$;

COMMIT;
