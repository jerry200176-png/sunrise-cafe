-- 分店付款/話術設定：移除程式內大安店硬編碼，改由資料庫驅動
-- 安全：純新增欄位，向下相容。請在部署新版程式「之前」執行。

ALTER TABLE branches ADD COLUMN IF NOT EXISTS display_name TEXT;   -- 對客顯示店名，例：昇昇咖啡 (大安店)
ALTER TABLE branches ADD COLUMN IF NOT EXISTS payment_info TEXT;   -- 匯款資訊（多行），含銀行/帳號/戶名
ALTER TABLE branches ADD COLUMN IF NOT EXISTS line_pay_url TEXT;   -- LINE Pay 付款連結

-- 將既有大安店的硬編碼內容遷移為資料（沿用原本對客話術，行為不變）
UPDATE branches
SET
  display_name = COALESCE(display_name, '昇昇咖啡 (大安店)'),
  payment_info = COALESCE(
    payment_info,
    E'【匯款資訊】\n銀行：台北富邦銀行 (012)\n帳號：8212-00000-8489-6\n戶名：昇昇咖啡張文霞'
  ),
  line_pay_url = COALESCE(
    line_pay_url,
    'https://qrcodepay.line.me/qr/payment/%252BmF6rR41PSp3R8NMydLA%252BRt1IvAFgPchBvtrJoR20aoZKY4Hr1qrbfaYSoPDUyu0'
  )
WHERE name LIKE '%大安%';
