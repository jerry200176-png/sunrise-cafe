-- 人工轉發訂位訊息工作台的 append-only 操作紀錄
CREATE TABLE IF NOT EXISTS reservation_message_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  template_key TEXT NOT NULL CHECK (
    template_key IN ('booking_confirmation', 'deposit_request', 'deposit_paid', 'arrival_reminder')
  ),
  channel TEXT NOT NULL CHECK (channel IN ('manual_line', 'official_line')),
  action TEXT NOT NULL CHECK (action IN ('copied', 'manual_sent', 'pushed', 'failed')),
  actor_user_id UUID REFERENCES admin_users(id) ON DELETE RESTRICT,
  rendered_text TEXT NOT NULL CHECK (length(rendered_text) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE reservation_message_actions IS
  '訂位訊息產生、人工轉發與官方 LINE 推播的 append-only 稽核紀錄；後端經 service_role 寫入';

CREATE INDEX IF NOT EXISTS idx_reservation_message_actions_reservation
  ON reservation_message_actions(reservation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservation_message_actions_created
  ON reservation_message_actions(created_at DESC);

ALTER TABLE reservation_message_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all_reservation_message_actions" ON reservation_message_actions;
CREATE POLICY "service_all_reservation_message_actions"
  ON reservation_message_actions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION prevent_reservation_message_action_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'reservation_message_actions is append-only';
END;
$$;

DROP TRIGGER IF EXISTS reservation_message_actions_append_only
  ON reservation_message_actions;
CREATE TRIGGER reservation_message_actions_append_only
  BEFORE UPDATE OR DELETE ON reservation_message_actions
  FOR EACH ROW EXECUTE FUNCTION prevent_reservation_message_action_mutation();

INSERT INTO schema_migrations (version, name)
VALUES ('20260813-reservation-message-actions', 'migration-reservation-message-actions.sql')
ON CONFLICT (version) DO NOTHING;
