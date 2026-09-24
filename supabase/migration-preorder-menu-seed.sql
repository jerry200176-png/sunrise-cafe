-- Make currently available menu items selectable during room booking.
-- Staff can disable preorder eligibility per item after this one-time seed.
BEGIN;

CREATE TABLE IF NOT EXISTS preorder_menu_seed_changes (
  menu_item_id uuid PRIMARY KEY,
  previous_preorder_eligible boolean NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE preorder_menu_seed_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON preorder_menu_seed_changes FROM PUBLIC, anon, authenticated;

INSERT INTO preorder_menu_seed_changes (menu_item_id, previous_preorder_eligible)
SELECT id, preorder_eligible FROM menu_items
 WHERE is_available = true AND preorder_eligible = false
ON CONFLICT (menu_item_id) DO NOTHING;

UPDATE menu_items
   SET preorder_eligible = true
 WHERE is_available = true
   AND preorder_eligible = false
   AND id IN (SELECT menu_item_id FROM preorder_menu_seed_changes);

INSERT INTO schema_migrations (version, name)
VALUES ('20260924-preorder-menu-seed', 'migration-preorder-menu-seed.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
