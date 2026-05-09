ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS payment_keywords TEXT[] DEFAULT ARRAY[
    '末五碼','五碼','匯款','付款','已付','已轉','轉帳',
    'line pay','linepay','截圖','收款','轉過去','付過去'
  ];
