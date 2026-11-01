-- Minimal isolated Postgres test fixture, never for production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE public.reservations(id uuid PRIMARY KEY, status text NOT NULL);
CREATE TABLE public.orders(id uuid PRIMARY KEY, reservation_id uuid REFERENCES public.reservations(id), paid_at timestamptz, status text NOT NULL DEFAULT 'pending', total_amount numeric DEFAULT 0);
CREATE TABLE public.order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.orders(id), menu_item_id uuid, item_name text NOT NULL, quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99), unit_price numeric NOT NULL, selected_options jsonb, special_notes text, served_at timestamptz);
-- Model the production guard's serialization point for all item mutations.
CREATE FUNCTION public.fixture_guard_order_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.orders WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER fixture_guard BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.fixture_guard_order_item();
CREATE FUNCTION public.fixture_recalculate_order_total() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.orders SET total_amount = (SELECT coalesce(sum(quantity * unit_price), 0) FROM public.order_items WHERE order_id=NEW.order_id) WHERE id=NEW.order_id;
  RETURN NULL;
END $$;
CREATE TRIGGER fixture_recalculate_total AFTER INSERT ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.fixture_recalculate_order_total();
GRANT SELECT, UPDATE ON public.reservations, public.orders TO service_role;
GRANT SELECT, INSERT ON public.order_items TO service_role;
INSERT INTO public.reservations(id,status) VALUES ('00000000-0000-0000-0000-000000000001','checked_in');
INSERT INTO public.orders(id,reservation_id) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
INSERT INTO public.reservations(id,status) VALUES ('00000000-0000-0000-0000-000000000004','checked_in');
INSERT INTO public.orders(id,reservation_id) VALUES ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004');
