-- 包廂改為「平日／假日」分開定價（已有 price_per_hour 的專案請執行此遷移）
-- 在 Supabase Dashboard → SQL Editor 執行

-- 新增欄位（先給預設，再從 price_per_hour 複製）
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS price_weekday NUMERIC;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS price_weekend NUMERIC;

UPDATE rooms
SET price_weekday = COALESCE(price_weekday, price_per_hour),
    price_weekend = COALESCE(price_weekend, price_per_hour)
WHERE price_per_hour IS NOT NULL;

ALTER TABLE rooms ALTER COLUMN price_weekday SET DEFAULT 0;
ALTER TABLE rooms ALTER COLUMN price_weekend SET DEFAULT 0;
ALTER TABLE rooms ALTER COLUMN price_weekday SET NOT NULL;
ALTER TABLE rooms ALTER COLUMN price_weekend SET NOT NULL;

-- 移除舊欄位（若存在）
ALTER TABLE rooms DROP COLUMN IF EXISTS price_per_hour;
