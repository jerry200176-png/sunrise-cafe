-- 大安店包廂：小包廂、會議室（需先有「昇咖啡 大安店」分店）
-- 在 SQL Editor 執行：僅為大安店新增這兩筆包廂
-- 平日 = 週一～五，假日 = 週六、日；預約時依所選日期自動套用對應單價。

INSERT INTO rooms (branch_id, name, type, capacity, price_weekday, price_weekend)
SELECT id, '小包廂', '一般包廂', 4, 200, 300
FROM branches
WHERE name = '昇咖啡 大安店'
LIMIT 1;

INSERT INTO rooms (branch_id, name, type, capacity, price_weekday, price_weekend)
SELECT id, '會議室', '會議室', 12, 400, 500
FROM branches
WHERE name = '昇咖啡 大安店'
LIMIT 1;

-- 定價：小包廂 平日 200/時、假日 300/時；會議室 平日 400/時、假日 500/時
