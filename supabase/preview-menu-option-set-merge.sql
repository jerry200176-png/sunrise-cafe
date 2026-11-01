-- 唯讀預覽（只有 SELECT，不改任何資料）：在 Supabase SQL Editor 貼上執行。
-- 這是執行當下的資料，不是遷移前的歷史快照；不得用來證明先前的預覽或遷移結果。
-- 結果每一列 = 一個將建立的選項組：分店、組名、選項內容、會套用到哪些餐點。
-- 規則與 migration-menu-option-sets.sql 相同：同分店＋同組名＋選項名稱與加價完全相同 → 合併。
-- 同組名但內容不同 → 之後會命名為「組名 (2)」…；「不會合併」的餐點在第二個查詢。
WITH legacy AS (
  SELECT mo.item_id, mi.name AS item_name, mi.branch_id, mo.option_group,
         md5(string_agg(mo.option_name || E'\u0001' || mo.price_delta::text, E'\u0002' ORDER BY mo.option_name, mo.price_delta)) AS sig,
         string_agg(mo.option_name || CASE WHEN mo.price_delta <> 0 THEN '(' || CASE WHEN mo.price_delta > 0 THEN '+' ELSE '' END || mo.price_delta || ')' ELSE '' END,
                    '、' ORDER BY mo.display_order) AS choices
    FROM menu_item_options AS mo
    JOIN menu_items AS mi ON mi.id = mo.item_id
   -- set_id 欄位在 migration 以前不存在；to_jsonb 可兼容前後兩種 schema。
   WHERE to_jsonb(mo)->>'set_id' IS NULL
   GROUP BY mo.item_id, mi.name, mi.branch_id, mo.option_group
  HAVING count(*) = count(DISTINCT mo.option_name)
)
SELECT b.name AS 分店,
       l.option_group AS 組名,
       row_number() OVER (PARTITION BY l.branch_id, l.option_group ORDER BY count(*) DESC, l.sig) AS 同組名第幾種,
       (array_agg(l.choices ORDER BY l.item_id::text))[1] AS 選項,
       count(*) AS 套用餐點數,
       string_agg(l.item_name, '、' ORDER BY l.item_name) AS 餐點
  FROM legacy AS l
  JOIN branches AS b ON b.id = l.branch_id
 GROUP BY b.name, l.branch_id, l.option_group, l.sig
 ORDER BY 1, 2, 3;

-- 不會合併（同一餐點同組內選項名稱重複）。結果為空表示全部都能合併。
SELECT mi.name AS 餐點, mo.option_group AS 組名
  FROM menu_item_options AS mo
  JOIN menu_items AS mi ON mi.id = mo.item_id
 WHERE to_jsonb(mo)->>'set_id' IS NULL
 GROUP BY mi.id, mi.name, mo.option_group
HAVING count(*) <> count(DISTINCT mo.option_name);
