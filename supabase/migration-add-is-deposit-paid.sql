-- 新增訂金是否已支付欄位
ALTER TABLE reservations 
ADD COLUMN is_deposit_paid BOOLEAN DEFAULT false;
