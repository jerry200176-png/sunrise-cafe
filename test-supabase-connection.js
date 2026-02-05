// test-supabase-connection.js
// 最終測試：無視 SSL + 強制 IPv4
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // 👈 關鍵：關閉 SSL 檢查

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const dns = require('node:dns');

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('\n--- 最終測試 (無視 SSL 安全性) ---');

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

async function testConnection() {
  try {
    console.log(`正在連線到: ${supabaseUrl}`);
    // 嘗試連線
    const { data, error } = await supabase.from('test').select('*').limit(1);
    
    // 只要有回應（不管是資料還是錯誤代碼），都算連線成功
    if (error && error.message.includes('fetch failed')) {
      throw error;
    }
    
    console.log('\n✅ 連線成功！');
    console.log('🎉 抓到兇手了：是您的「防毒軟體」或「防火牆」攔截了 SSL 憑證。');
    
  } catch (err) {
    console.error('\n❌ 徹底失敗。');
    console.error('這代表您的網路完全無法連外，請切換手機熱點再試。');
    console.error(err);
  }
}

testConnection();