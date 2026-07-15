-- D-1 guest attendance confirmation (LINE Flex Confirm CTA)
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS guest_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN reservations.guest_confirmed_at IS '客人透過 D-1 提醒確認準時到店的時間';
