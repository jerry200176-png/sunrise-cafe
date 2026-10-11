-- 經營總覽建議決策（資料庫部分）：
-- 1) reservations.status 多一個「no_show」（店員標記沒來）。只放寬 CHECK，不改任何現有資料。
--    ※ 若現有資料有第六種以外的狀態，ADD CONSTRAINT 會失敗並整個還原（交易），不會留下半套。
-- 2) advice_decisions：每個建議店員按「採用」或「略過」的紀錄；採用後 4 週再比對前後數字。
--    一個 (suggestion_id) 一列（重按會覆蓋），只有 service_role 可讀寫（後台 API 走伺服器）。
-- Rollback (after reverting the code):
--   DROP TABLE advice_decisions;
--   UPDATE reservations SET status = 'cancelled' WHERE status = 'no_show';  -- 只有真的標過沒來才需要，先確認
--   ALTER TABLE reservations DROP CONSTRAINT reservations_status_check;
--   ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
--     CHECK (status IN ('pending', 'confirmed', 'checked_in', 'cancelled', 'completed'));
--   DELETE FROM schema_migrations WHERE version = '20261011-no-show-advice';
BEGIN;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('pending', 'confirmed', 'checked_in', 'cancelled', 'completed', 'no_show'));

CREATE TABLE IF NOT EXISTS advice_decisions (
  suggestion_id text PRIMARY KEY,
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('adopted', 'skipped')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  -- 決定當下的數字（建議卡上的 numbers 與估計金額），4 週後拿來和新數字比
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_advice_decisions_branch ON advice_decisions(branch_id);

ALTER TABLE advice_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_all_advice_decisions" ON advice_decisions;
CREATE POLICY "service_all_advice_decisions" ON advice_decisions FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO schema_migrations (version, name)
VALUES ('20261011-no-show-advice', 'migration-no-show-advice.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
