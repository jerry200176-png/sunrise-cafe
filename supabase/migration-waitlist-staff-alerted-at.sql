-- One-shot staff LINE alert when waitlist guest needs a phone call (no LINE bind)
ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS staff_alerted_at TIMESTAMPTZ;

COMMENT ON COLUMN waitlist.staff_alerted_at IS
  '系統已推播「需電聯」到店員群組的時間（無 LINE 綁定時）';
