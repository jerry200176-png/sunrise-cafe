-- Synthetic fixture only. NOT a migration, application RPC, policy or deployable contract.
-- Assume authentic provider events and a known full-refund semantic; neither is verified here.
CREATE SCHEMA study_receipt;
REVOKE ALL ON SCHEMA study_receipt FROM PUBLIC;
CREATE TABLE study_receipt.reservations (id integer PRIMARY KEY, state text NOT NULL CHECK (state IN ('pending','paid','refunded')));
CREATE TABLE study_receipt.intents (
 reservation_id integer PRIMARY KEY REFERENCES study_receipt.reservations(id), intent_ref text NOT NULL UNIQUE,
 state text NOT NULL CHECK (state IN ('pending','succeeded','refunded')), amount integer NOT NULL, currency text NOT NULL
);
CREATE TABLE study_receipt.inbox (
 event_id text PRIMARY KEY, reservation_id integer, intent_ref text NOT NULL, kind text NOT NULL,
 amount integer NOT NULL, currency text NOT NULL, state text NOT NULL DEFAULT 'received'
);
CREATE TABLE study_receipt.conflicts (
 event_id text NOT NULL, reservation_id integer, intent_ref text NOT NULL, kind text NOT NULL,
 amount integer NOT NULL, currency text NOT NULL,
 UNIQUE NULLS NOT DISTINCT (event_id, reservation_id, intent_ref, kind, amount, currency)
);
CREATE TABLE study_receipt.audit (stable_key text PRIMARY KEY, reservation_id integer NOT NULL, kind text NOT NULL);
CREATE TABLE study_receipt.outbox (stable_key text PRIMARY KEY, reservation_id integer NOT NULL, state text NOT NULL);

-- The receive transaction MUST commit before caller acknowledges receipt or
-- invokes apply_event. Conflict details here are synthetic typed fields only.
CREATE FUNCTION study_receipt.receive_event(
 p_event text, p_reservation integer, p_ref text, p_kind text, p_amount integer, p_currency text
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE old_event study_receipt.inbox%ROWTYPE;
BEGIN
 INSERT INTO study_receipt.inbox(event_id,reservation_id,intent_ref,kind,amount,currency)
   VALUES (p_event,p_reservation,p_ref,p_kind,p_amount,p_currency) ON CONFLICT DO NOTHING;
 IF FOUND THEN RETURN 'received'; END IF;
 SELECT * INTO STRICT old_event FROM study_receipt.inbox WHERE event_id=p_event FOR UPDATE;
 IF old_event.reservation_id IS DISTINCT FROM p_reservation OR old_event.intent_ref <> p_ref OR
    old_event.kind <> p_kind OR old_event.amount <> p_amount OR old_event.currency <> p_currency THEN
   -- Serialize conflict publication with claims on the original reservation.
   -- Already claimed external effects cannot be recalled by this fixture.
   PERFORM 1 FROM study_receipt.reservations WHERE id=old_event.reservation_id FOR UPDATE;
   INSERT INTO study_receipt.conflicts VALUES (p_event,p_reservation,p_ref,p_kind,p_amount,p_currency)
     ON CONFLICT DO NOTHING;
   UPDATE study_receipt.inbox SET state='conflict' WHERE event_id=p_event;
   RETURN 'conflict';
 END IF;
 IF old_event.state = 'conflict' THEN RETURN 'duplicate_conflict'; END IF;
 RETURN 'duplicate';
END $$;

-- Fixed synthetic lock order: inbox, reservation, intent, outbox.
CREATE FUNCTION study_receipt.apply_event(p_event text, p_fail boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE e study_receipt.inbox%ROWTYPE; r study_receipt.reservations%ROWTYPE;
        i study_receipt.intents%ROWTYPE; resolved text;
BEGIN
 SELECT * INTO STRICT e FROM study_receipt.inbox WHERE event_id=p_event FOR UPDATE;
 IF e.state <> 'received' THEN RETURN e.state; END IF;
 SELECT * INTO r FROM study_receipt.reservations WHERE id=e.reservation_id FOR UPDATE;
 IF NOT FOUND THEN
   UPDATE study_receipt.inbox SET state='reconciliation_required' WHERE event_id=p_event;
   RETURN 'reconciliation_required';
 END IF;
 SELECT * INTO i FROM study_receipt.intents WHERE reservation_id=r.id AND intent_ref=e.intent_ref FOR UPDATE;
 IF NOT FOUND OR e.amount <> i.amount OR e.currency <> i.currency OR e.kind NOT IN ('success','refund_full') THEN
   UPDATE study_receipt.inbox SET state='reconciliation_required' WHERE event_id=p_event;
   RETURN 'reconciliation_required';
 END IF;
 IF e.kind='refund_full' THEN
   UPDATE study_receipt.intents SET state='refunded' WHERE reservation_id=r.id;
   UPDATE study_receipt.reservations SET state='refunded' WHERE id=r.id;
   INSERT INTO study_receipt.audit VALUES ('refund:'||r.id,r.id,'refund') ON CONFLICT DO NOTHING;
   UPDATE study_receipt.outbox SET state='cancelled' WHERE reservation_id=r.id AND state='pending';
   IF EXISTS (SELECT 1 FROM study_receipt.outbox WHERE reservation_id=r.id AND state IN ('claimed','delivered')) THEN
     resolved='refunded_delivery_reconcile';
   ELSE resolved='refunded'; END IF;
 ELSIF r.state='refunded' OR i.state='refunded' THEN
   resolved='reconciliation_required';
 ELSE
   UPDATE study_receipt.intents SET state='succeeded' WHERE reservation_id=r.id;
   UPDATE study_receipt.reservations SET state='paid' WHERE id=r.id;
   INSERT INTO study_receipt.audit VALUES ('paid:'||r.id,r.id,'paid') ON CONFLICT DO NOTHING;
   INSERT INTO study_receipt.outbox VALUES ('paid:'||r.id,r.id,'pending') ON CONFLICT DO NOTHING;
   resolved='paid';
 END IF;
 UPDATE study_receipt.inbox SET state=resolved WHERE event_id=p_event;
 IF p_fail THEN RAISE EXCEPTION 'synthetic apply failure'; END IF;
 RETURN resolved;
END $$;

-- Claim is only a synthetic local state transition, not an external delivery.
-- Its lock order is compatible with apply_event: reservation before outbox.
CREATE FUNCTION study_receipt.claim_paid(p_id integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
 PERFORM 1 FROM study_receipt.reservations WHERE id=p_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM study_receipt.inbox WHERE reservation_id=p_id AND state='conflict') THEN
   RETURN 'not_claimed';
 END IF;
 SELECT state INTO s FROM study_receipt.outbox WHERE stable_key='paid:'||p_id FOR UPDATE;
 IF NOT FOUND OR s <> 'pending' THEN RETURN 'not_claimed'; END IF;
 UPDATE study_receipt.outbox SET state='claimed' WHERE stable_key='paid:'||p_id;
 RETURN 'claimed';
END $$;
