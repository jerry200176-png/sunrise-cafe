-- Disposable research fixture only. This is not Sunrise production code or policy.
CREATE SCHEMA study;
CREATE TABLE study.reservations (
 id integer PRIMARY KEY, status text NOT NULL, paid boolean,
 room_id integer NOT NULL DEFAULT 1, start_at timestamptz NOT NULL DEFAULT '2030-01-01 10:00+00',
 end_at timestamptz NOT NULL DEFAULT '2030-01-01 11:00+00'
);
CREATE TABLE study.attempts (
 reservation_id integer NOT NULL REFERENCES study.reservations(id), provider text NOT NULL,
 state text NOT NULL, PRIMARY KEY(reservation_id,provider)
);
CREATE TABLE study.events (
 event_key text PRIMARY KEY, reservation_id integer NOT NULL REFERENCES study.reservations(id),
 kind text NOT NULL
);
CREATE TABLE study.outbox (
 event_key text PRIMARY KEY, reservation_id integer NOT NULL REFERENCES study.reservations(id),
 kind text NOT NULL
);
CREATE TABLE study.provider_evidence (
 provider_event_id text PRIMARY KEY, reservation_id integer NOT NULL REFERENCES study.reservations(id),
 provider text NOT NULL, outcome text NOT NULL
);
CREATE FUNCTION study.claim(p_id integer,p_provider text,p_state text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r study.reservations%ROWTYPE;
BEGIN
 SELECT * INTO STRICT r FROM study.reservations WHERE id=p_id FOR UPDATE;
 IF r.status NOT IN ('pending','confirmed') OR r.paid IS TRUE THEN RETURN 'rejected'; END IF;
 IF p_state <> 'creating' THEN RAISE EXCEPTION 'fresh synthetic claim must start creating'; END IF;
 INSERT INTO study.attempts VALUES(p_id,p_provider,p_state) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN 'duplicate'; END IF;
 RETURN 'claimed';
END $$;
CREATE FUNCTION study.cancel(p_id integer,p_fail boolean DEFAULT false) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r study.reservations%ROWTYPE;
BEGIN
 SELECT * INTO STRICT r FROM study.reservations WHERE id=p_id FOR UPDATE;
 IF r.status NOT IN ('pending','confirmed') THEN RETURN 'stale'; END IF;
 IF r.paid IS TRUE THEN RETURN 'paid'; END IF;
 IF EXISTS(SELECT 1 FROM study.attempts WHERE reservation_id=p_id AND state IN ('creating','pending','confirming','unknown')) THEN RETURN 'deferred'; END IF;
 UPDATE study.reservations SET status='cancelled' WHERE id=p_id;
 INSERT INTO study.events VALUES('cancel:'||p_id,p_id,'cancel') ON CONFLICT DO NOTHING;
 INSERT INTO study.outbox VALUES('cancel:'||p_id,p_id,'cancel') ON CONFLICT DO NOTHING;
 IF p_fail THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF;
 RETURN 'cancelled';
END $$;
CREATE FUNCTION study.check_in(p_id integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r study.reservations%ROWTYPE;
BEGIN
 SELECT * INTO STRICT r FROM study.reservations WHERE id=p_id FOR UPDATE;
 IF r.status NOT IN ('pending','confirmed') THEN RETURN 'stale'; END IF;
 UPDATE study.reservations SET status='checked_in' WHERE id=p_id;
 INSERT INTO study.events VALUES('checkin:'||p_id,p_id,'checkin') ON CONFLICT DO NOTHING;
 INSERT INTO study.outbox VALUES('checkin:'||p_id,p_id,'checkin') ON CONFLICT DO NOTHING;
 RETURN 'checked_in';
END $$;
CREATE FUNCTION study.provider_success(p_id integer,p_provider text,p_event text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r study.reservations%ROWTYPE; existing study.provider_evidence%ROWTYPE; resolved text;
BEGIN
 SELECT * INTO STRICT r FROM study.reservations WHERE id=p_id FOR UPDATE;
 SELECT * INTO existing FROM study.provider_evidence WHERE provider_event_id=p_event;
 IF FOUND THEN
   IF existing.reservation_id <> p_id OR existing.provider <> p_provider THEN RAISE EXCEPTION 'conflicting synthetic event identity'; END IF;
   RETURN existing.outcome;
 END IF;
 -- Fixed lock order: reservation, then matching attempt.
 PERFORM 1 FROM study.attempts WHERE reservation_id=p_id AND provider=p_provider FOR UPDATE;
 IF r.status='cancelled' THEN resolved='reconciliation_required'; ELSE resolved='paid'; END IF;
 INSERT INTO study.provider_evidence VALUES(p_event,p_id,p_provider,resolved);
 INSERT INTO study.attempts VALUES(p_id,p_provider,resolved)
   ON CONFLICT(reservation_id,provider) DO UPDATE SET state=EXCLUDED.state;
 IF resolved='paid' THEN
   UPDATE study.reservations SET paid=true WHERE id=p_id;
   INSERT INTO study.events VALUES('paid:'||p_id,p_id,'paid') ON CONFLICT DO NOTHING;
   INSERT INTO study.outbox VALUES('paid:'||p_id,p_id,'paid') ON CONFLICT DO NOTHING;
 END IF;
 RETURN resolved;
END $$;
-- Synthetic slot-exclusion fixture only; this does not recreate the production schema.
CREATE EXTENSION btree_gist;
CREATE TABLE study.slot_claims (
 id integer PRIMARY KEY, room_id integer NOT NULL, status text NOT NULL, slot tstzrange NOT NULL,
 EXCLUDE USING gist (room_id WITH =, slot WITH &&) WHERE (status IN ('pending','confirmed','checked_in'))
);
CREATE FUNCTION study.restore_slot(p_id integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 UPDATE study.slot_claims SET status='pending' WHERE id=p_id AND status='cancelled';
 IF NOT FOUND THEN RETURN 'stale'; END IF;
 RETURN 'restored';
EXCEPTION WHEN exclusion_violation THEN RETURN 'slot_conflict';
END $$;
CREATE FUNCTION study.create_slot(p_id integer,p_room integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO study.slot_claims VALUES(p_id,p_room,'pending',tstzrange('2030-01-01 10:00+00','2030-01-01 11:00+00','[)'));
 RETURN 'created';
EXCEPTION WHEN exclusion_violation THEN RETURN 'slot_conflict';
END $$;
