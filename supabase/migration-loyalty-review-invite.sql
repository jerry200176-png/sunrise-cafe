-- Issue #43：會員標記 / 訂位後邀評
-- 1. settings 新增可由後台設定的 Google 評論連結
-- 2. reservations 新增 review_invited_at，避免同一筆訂位重複發送邀評

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS google_review_url TEXT;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS review_invited_at TIMESTAMPTZ;
