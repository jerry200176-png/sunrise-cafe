-- 自助點餐系統遷移
-- 在 Supabase Dashboard → SQL Editor 執行此腳本

-- 1. 桌位（每個桌位有唯一 qr_token 供 QR Code 掃描用）
CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  qr_token TEXT NOT NULL UNIQUE DEFAULT upper(substring(md5(gen_random_uuid()::text), 1, 12)),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tables_branch_id ON tables(branch_id);
CREATE INDEX IF NOT EXISTS idx_tables_qr_token ON tables(qr_token);

-- 2. 菜單分類
CREATE TABLE IF NOT EXISTS menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_menu_categories_branch_id ON menu_categories(branch_id);

-- 3. 餐點
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  category_id UUID REFERENCES menu_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  image_url TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_menu_items_branch_id ON menu_items(branch_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category_id ON menu_items(category_id);

-- 4. 餐點客製化選項（甜度、冰塊、加料等）
CREATE TABLE IF NOT EXISTS menu_item_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  option_group TEXT NOT NULL,  -- e.g. "甜度", "冰塊", "加料"
  option_name TEXT NOT NULL,   -- e.g. "全糖", "半糖", "少冰"
  price_delta NUMERIC NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_menu_item_options_item_id ON menu_item_options(item_id);

-- 5. 訂單主表
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  table_id UUID REFERENCES tables(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  is_printed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_branch_id ON orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_table_id ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- 6. 訂單明細
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,          -- 快照，避免餐點改名後歷史資料錯誤
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  selected_options JSONB,           -- [{group:"甜度",name:"半糖",delta:0}]
  special_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- 7. RLS：允許匿名用戶讀取菜單與桌位，匿名建立訂單
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_item_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- 先刪除舊 policy（避免重複執行報錯）
DROP POLICY IF EXISTS "anon_read_tables" ON tables;
DROP POLICY IF EXISTS "anon_read_menu_categories" ON menu_categories;
DROP POLICY IF EXISTS "anon_read_menu_items" ON menu_items;
DROP POLICY IF EXISTS "anon_read_menu_item_options" ON menu_item_options;
DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
DROP POLICY IF EXISTS "anon_insert_order_items" ON order_items;
DROP POLICY IF EXISTS "anon_read_orders" ON orders;
DROP POLICY IF EXISTS "anon_read_order_items" ON order_items;
DROP POLICY IF EXISTS "service_all_tables" ON tables;
DROP POLICY IF EXISTS "service_all_menu_categories" ON menu_categories;
DROP POLICY IF EXISTS "service_all_menu_items" ON menu_items;
DROP POLICY IF EXISTS "service_all_menu_item_options" ON menu_item_options;
DROP POLICY IF EXISTS "service_all_orders" ON orders;
DROP POLICY IF EXISTS "service_all_order_items" ON order_items;

-- 顧客可讀取（anon）
CREATE POLICY "anon_read_tables" ON tables FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_menu_categories" ON menu_categories FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_menu_items" ON menu_items FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_menu_item_options" ON menu_item_options FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_orders" ON orders FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_insert_order_items" ON order_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_read_orders" ON orders FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_order_items" ON order_items FOR SELECT TO anon USING (true);

-- Service role 完整存取（後端 API 與列印橋接服務用）
CREATE POLICY "service_all_tables" ON tables FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_menu_categories" ON menu_categories FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_menu_items" ON menu_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_menu_item_options" ON menu_item_options FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_orders" ON orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_order_items" ON order_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 8. Realtime：訂單即時推播（已加入則跳過）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;
END $$;
