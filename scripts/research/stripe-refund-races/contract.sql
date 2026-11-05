-- SYNTHETIC RESEARCH ONLY: not an application migration or payment policy.
-- Fixed fixture assumptions: one known reservation/intent, verified full refund,
-- fixed amount and currency. Unknown bindings and real providers are NOT modeled.
CREATE SCHEMA study_refund;
CREATE TABLE study_refund.reservations (
 id integer PRIMARY KEY, deposit_state text NOT NULL CHECK (deposit_state IN ('pending','paid','refunded'))
);
CREATE TABLE study_refund.intents (
 reservation_id integer PRIMARY KEY REFERENCES study_refund.reservations(id),
 state text NOT NULL CHECK (state IN ('pending','succeeded','refunded')),
 amount integer NOT NULL, currency text NOT NULL
);
CREATE TABLE study_refund.events (
 event_id text PRIMARY KEY, reservation_id integer NOT NULL, kind text NOT NULL,
 amount integer NOT NULL, currency text NOT NULL, outcome text NOT NULL
);
CREATE TABLE study_refund.conflicts (
 event_id text NOT NULL, reservation_id integer NOT NULL, kind text NOT NULL,
 amount integer NOT NULL, currency text NOT NULL,
 PRIMARY KEY (event_id, reservation_id, kind, amount, currency)
);
CREATE TABLE study_refund.outbox (
 stable_key text PRIMARY KEY, reservation_id integer NOT NULL, kind text NOT NULL
);
CREATE TABLE study_refund.audit (
 stable_key text PRIMARY KEY, reservation_id integer NOT NULL, kind text NOT NULL
);

CREATE FUNCTION study_refund.apply_event(
 p_id integer, p_event text, p_kind text, p_amount integer, p_currency text,
 p_fail boolean DEFAULT false
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
 r study_refund.reservations%ROWTYPE;
 i study_refund.intents%ROWTYPE;
 old_event study_refund.events%ROWTYPE;
 event_outcome text;
BEGIN
 -- A fixed lock order for this fixture: reservation, then intent. The caller
 -- MUST supply a known bound reservation; missing/unknown binding not modeled.
 SELECT * INTO STRICT r FROM study_refund.reservations WHERE id = p_id FOR UPDATE;
 SELECT * INTO STRICT i FROM study_refund.intents WHERE reservation_id = p_id FOR UPDATE;
 INSERT INTO study_refund.events VALUES (p_event, p_id, p_kind, p_amount, p_currency, 'received')
 ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN
   SELECT * INTO STRICT old_event FROM study_refund.events WHERE event_id = p_event;
   IF old_event.reservation_id <> p_id OR old_event.kind <> p_kind OR
      old_event.amount <> p_amount OR old_event.currency <> p_currency THEN
     INSERT INTO study_refund.conflicts VALUES (p_event, p_id, p_kind, p_amount, p_currency)
       ON CONFLICT DO NOTHING;
     RETURN 'conflict';
   END IF;
   RETURN old_event.outcome;
 END IF;
 -- The whole-refund event is a SYNTHETIC assumption, not a Stripe policy.
 IF p_amount <> i.amount OR p_currency <> i.currency OR p_kind NOT IN ('success','refund_full') THEN
   event_outcome := 'reconciliation_required';
 ELSIF p_kind = 'refund_full' THEN
   UPDATE study_refund.intents SET state = 'refunded' WHERE reservation_id = p_id;
   UPDATE study_refund.reservations SET deposit_state = 'refunded' WHERE id = p_id;
   INSERT INTO study_refund.audit VALUES ('refund:'||p_id, p_id, 'refund') ON CONFLICT DO NOTHING;
   event_outcome := 'refunded';
 ELSIF r.deposit_state = 'refunded' OR i.state = 'refunded' THEN
   event_outcome := 'reconciliation_required';
 ELSE
   UPDATE study_refund.intents SET state = 'succeeded' WHERE reservation_id = p_id;
   UPDATE study_refund.reservations SET deposit_state = 'paid' WHERE id = p_id;
   INSERT INTO study_refund.audit VALUES ('paid:'||p_id, p_id, 'paid') ON CONFLICT DO NOTHING;
   INSERT INTO study_refund.outbox VALUES ('paid:'||p_id, p_id, 'paid') ON CONFLICT DO NOTHING;
   event_outcome := 'paid';
 END IF;
 UPDATE study_refund.events SET outcome = event_outcome WHERE event_id = p_event;
 IF p_fail THEN RAISE EXCEPTION 'synthetic transaction failure'; END IF;
 RETURN event_outcome;
END $$;
