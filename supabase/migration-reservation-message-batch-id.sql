-- Add a nullable batch identifier to the append-only message audit table.
-- Safe to run more than once; existing single-message audits remain valid.

ALTER TABLE reservation_message_actions
  ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_reservation_message_actions_batch
  ON reservation_message_actions(batch_id, created_at ASC);

CREATE OR REPLACE FUNCTION prevent_reservation_message_action_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- ON DELETE SET NULL preserves the audit row when a reservation is deleted.
  -- This is the only permitted mutation; all message fields remain immutable.
  IF TG_OP = 'UPDATE' AND OLD.reservation_id IS NOT NULL AND NEW.reservation_id IS NULL
     AND OLD.template_key = NEW.template_key
     AND OLD.channel = NEW.channel
     AND OLD.action = NEW.action
     AND OLD.actor_user_id IS NOT DISTINCT FROM NEW.actor_user_id
     AND OLD.rendered_text = NEW.rendered_text
     AND OLD.batch_id IS NOT DISTINCT FROM NEW.batch_id
     AND OLD.created_at = NEW.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'reservation_message_actions is append-only';
END;
$$;

INSERT INTO schema_migrations (version, name)
VALUES ('20260813-reservation-message-batch-id', 'migration-reservation-message-batch-id.sql')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
