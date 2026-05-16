-- 各分店的 LINE 群組 ID（設定後 Cron 自動推播到對應群組）
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS line_group_id TEXT;
