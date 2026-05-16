CREATE TABLE IF NOT EXISTS waitlist (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID        NOT NULL REFERENCES rooms(id),
  start_time  TIMESTAMPTZ NOT NULL,
  end_time    TIMESTAMPTZ NOT NULL,
  customer_name TEXT      NOT NULL,
  phone       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  status      TEXT        NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'notified', 'expired'))
);

CREATE INDEX IF NOT EXISTS waitlist_room_time ON waitlist (room_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS waitlist_phone ON waitlist (phone);
