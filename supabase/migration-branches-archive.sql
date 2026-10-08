-- 分店「封存」取代「刪除」：封存只是隱藏，訂位／訂單／包廂資料全部保留，可還原。
-- 1) branches.archived_at：NULL = 營業中；有值 = 已封存（客人訂位頁、後台選單、提醒推播都不再出現）。
-- 2) 安全閥：分店底下只要有訂位或訂單，就不允許 DELETE（原本 ON DELETE CASCADE 會連訂位與訂單一起刪掉）。
--    沒有任何訂位／訂單的分店（例如剛建錯的空分店）仍可刪除。
-- Additive: one nullable column + one BEFORE DELETE trigger. No existing row is modified.
-- Rollback (after reverting the code that reads it):
--   DROP TRIGGER IF EXISTS branches_prevent_delete_with_history ON branches;
--   DROP FUNCTION IF EXISTS public.prevent_branch_delete_with_history();
--   ALTER TABLE branches DROP COLUMN archived_at;
--   DELETE FROM schema_migrations WHERE version = '20261008-branches-archive';
BEGIN;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE OR REPLACE FUNCTION public.prevent_branch_delete_with_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM reservations r JOIN rooms rm ON rm.id = r.room_id WHERE rm.branch_id = OLD.id
  ) OR EXISTS (
    SELECT 1 FROM orders o WHERE o.branch_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'branch % has reservations or orders; archive it instead of deleting', OLD.id
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS branches_prevent_delete_with_history ON branches;
CREATE TRIGGER branches_prevent_delete_with_history
  BEFORE DELETE ON branches
  FOR EACH ROW EXECUTE FUNCTION public.prevent_branch_delete_with_history();

INSERT INTO schema_migrations (version, name)
VALUES ('20261008-branches-archive', 'migration-branches-archive.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;
