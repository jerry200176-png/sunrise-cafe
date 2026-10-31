-- Candidate only; no production plan or execution. Service-role callers must
-- compare the customer's displayed prices before invoking this function.
BEGIN;
CREATE OR REPLACE FUNCTION public.create_table_order_checked(
  p_table_id uuid, p_branch_id uuid, p_table_token text, p_items jsonb, p_notes text
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_archived timestamptz;
  v_table public.tables%ROWTYPE;
  v_menu public.menu_items%ROWTYPE;
  v_opt public.menu_item_options%ROWTYPE;
  v_item jsonb;
  v_selected jsonb;
  v_optids uuid[];
  v_opt_snapshot jsonb;
  v_sum numeric;
  v_unit numeric;
  v_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_order uuid;
  v_index integer;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'qr_invalid_order' USING ERRCODE = '22023';
  END IF;
  SELECT archived_at INTO v_archived FROM public.branches WHERE id = p_branch_id FOR SHARE;
  IF NOT FOUND OR v_archived IS NOT NULL THEN RAISE EXCEPTION 'qr_branch_unavailable' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_table FROM public.tables WHERE id = p_table_id AND branch_id = p_branch_id AND qr_token = p_table_token FOR SHARE;
  IF NOT FOUND OR v_table.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'qr_table_unavailable' USING ERRCODE = 'P0001'; END IF;

  -- Lock in stable order. FOR UPDATE on items also prevents new FK-linked
  -- option rows appearing while the option set is being validated.
  PERFORM m.id FROM public.menu_items m
    WHERE m.id IN (SELECT (value->>'menu_item_id')::uuid FROM jsonb_array_elements(p_items))
    ORDER BY m.id FOR UPDATE;
  PERFORM o.id FROM public.menu_item_options o
    WHERE o.item_id IN (SELECT (value->>'menu_item_id')::uuid FROM jsonb_array_elements(p_items))
    ORDER BY o.id FOR UPDATE;
  PERFORM s.id FROM public.menu_option_sets s WHERE s.id IN (
    SELECT o.set_id FROM public.menu_item_options o WHERE o.item_id IN
      (SELECT (value->>'menu_item_id')::uuid FROM jsonb_array_elements(p_items)) AND o.set_id IS NOT NULL
  ) ORDER BY s.id FOR SHARE;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu FROM public.menu_items WHERE id=(v_item->>'menu_item_id')::uuid AND branch_id=p_branch_id;
    IF NOT FOUND OR v_menu.is_available IS DISTINCT FROM true OR v_menu.price IS DISTINCT FROM (v_item->>'base_price')::numeric
       OR v_menu.name IS DISTINCT FROM v_item->>'item_name' THEN
      RAISE EXCEPTION 'qr_catalog_changed' USING ERRCODE = 'P0001';
    END IF;
    IF (v_item->>'quantity')::integer NOT BETWEEN 1 AND 99 OR jsonb_typeof(v_item->'option_ids') <> 'array' THEN
      RAISE EXCEPTION 'qr_invalid_order' USING ERRCODE = '22023';
    END IF;
    v_optids := ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(v_item->'option_ids'));
    v_selected := COALESCE(v_item->'selected_options', '[]'::jsonb);
    IF v_selected = 'null'::jsonb THEN v_selected := '[]'::jsonb; END IF;
    IF jsonb_typeof(v_selected) <> 'array' OR jsonb_array_length(v_selected) <> cardinality(v_optids) THEN
      RAISE EXCEPTION 'qr_invalid_order' USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM public.assert_menu_item_option_selection(v_menu.id, v_optids);
    EXCEPTION WHEN raise_exception THEN
      RAISE EXCEPTION 'qr_catalog_changed' USING ERRCODE = 'P0001';
    END;
    v_sum := 0;
    IF cardinality(v_optids) > 0 THEN
      FOR v_index IN 1..cardinality(v_optids) LOOP
        SELECT * INTO v_opt FROM public.menu_item_options WHERE id=v_optids[v_index] AND item_id=v_menu.id;
        v_opt_snapshot := v_selected->(v_index - 1);
        IF NOT FOUND OR v_opt.option_group IS DISTINCT FROM v_opt_snapshot->>'group'
           OR v_opt.option_name IS DISTINCT FROM v_opt_snapshot->>'name'
           OR COALESCE(v_opt.price_delta,0) IS DISTINCT FROM (v_opt_snapshot->>'delta')::numeric THEN
          RAISE EXCEPTION 'qr_catalog_changed' USING ERRCODE = 'P0001';
        END IF;
        v_sum := v_sum + COALESCE(v_opt.price_delta,0);
      END LOOP;
    END IF;
    v_unit := v_menu.price + v_sum;
    -- Unit price is recomputed as numeric here; a JS floating-point sum in the
    -- request must neither set the price nor cause a false mismatch.
    IF v_unit < 0 THEN
      RAISE EXCEPTION 'qr_catalog_changed' USING ERRCODE = 'P0001';
    END IF;
    v_total := v_total + v_unit * (v_item->>'quantity')::integer;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'menu_item_id',v_menu.id,'item_name',v_menu.name,'quantity',(v_item->>'quantity')::integer,
      'unit_price',v_unit,'selected_options',CASE WHEN cardinality(v_optids)=0 THEN NULL ELSE v_selected END,
      'special_notes',v_item->>'special_notes'));
  END LOOP;
  INSERT INTO public.orders(branch_id, table_id, status, total_amount, notes)
    VALUES(p_branch_id,p_table_id,'pending',v_total,p_notes) RETURNING id INTO v_order;
  INSERT INTO public.order_items(order_id,menu_item_id,item_name,quantity,unit_price,selected_options,special_notes)
    SELECT v_order,(value->>'menu_item_id')::uuid,value->>'item_name',(value->>'quantity')::integer,
      (value->>'unit_price')::numeric,value->'selected_options',value->>'special_notes'
    FROM jsonb_array_elements(v_lines);
  RETURN v_order;
END;
$$;
REVOKE ALL ON FUNCTION public.create_table_order_checked(uuid,uuid,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_order_checked(uuid,uuid,text,jsonb,text) TO service_role;
COMMIT;
