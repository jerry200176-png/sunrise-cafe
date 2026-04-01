/**
 * print-bridge — 自助點餐列印橋接服務
 *
 * 用途：監聽 Supabase orders 表的新訂單，自動送出 ESC/POS 到
 *       Star TSP100III USB 印表機，列印廚房工單。
 *
 * 使用前：
 *   1. cp .env.example .env  → 填入 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   2. 確認 Star TSP100III USB 已連接此電腦
 *   3. npm install
 *   4. npm start
 */

require("dotenv").config({ path: ".env" });
const { createClient } = require("@supabase/supabase-js");
const escpos = require("escpos");
const USB = require("escpos-usb");
const { formatTicket } = require("./escpos-helper");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  請在 print-bridge/.env 填入 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ──────────────────────────────────────────────────────────
// 印表機操作
// ──────────────────────────────────────────────────────────

async function printOrder(order) {
  return new Promise((resolve, reject) => {
    let device;
    try {
      // 自動搜尋第一台 USB 裝置（Star TSP100 的 VID:PID = 0x0519:0x0003）
      device = new USB();
    } catch (err) {
      return reject(new Error(`找不到 USB 印表機：${err.message}`));
    }

    const printer = new escpos.Printer(device, { encoding: "Big5" });

    device.open((err) => {
      if (err) return reject(new Error(`開啟 USB 失敗：${err.message}`));

      const lines = formatTicket(order);

      printer
        .font("a")
        .align("lt")
        .style("normal")
        .size(1, 1);

      lines.forEach((line) => printer.text(line));

      printer.cut().close(() => resolve());
    });
  });
}

// ──────────────────────────────────────────────────────────
// 訂單查詢（含 table 與 order_items）
// ──────────────────────────────────────────────────────────

async function fetchOrderDetail(orderId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*, table:tables(number), order_items(*)")
    .eq("id", orderId)
    .single();
  if (error) throw error;
  return data;
}

async function markPrinted(orderId) {
  await supabase.from("orders").update({ is_printed: true }).eq("id", orderId);
}

// ──────────────────────────────────────────────────────────
// Realtime 訂閱
// ──────────────────────────────────────────────────────────

let channel = null;

function subscribe() {
  if (channel) supabase.removeChannel(channel);

  channel = supabase
    .channel("print-bridge-orders")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "orders" },
      async (payload) => {
        const orderId = payload.new?.id;
        if (!orderId) return;

        // 防重複：先確認 is_printed 仍為 false
        const { data: check } = await supabase
          .from("orders")
          .select("is_printed")
          .eq("id", orderId)
          .single();

        if (check?.is_printed) {
          console.log(`[SKIP] 訂單 ${orderId.slice(0, 8)} 已列印過，跳過`);
          return;
        }

        console.log(`[NEW ORDER] ${orderId.slice(0, 8)} — 正在列印…`);
        try {
          const order = await fetchOrderDetail(orderId);
          await printOrder(order);
          await markPrinted(orderId);
          console.log(`[OK] 訂單 ${orderId.slice(0, 8)} 列印完成`);
        } catch (err) {
          console.error(`[ERROR] 訂單 ${orderId.slice(0, 8)} 列印失敗：`, err.message);
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        console.log("[OK] 已連線到 Supabase Realtime，等待新訂單…");
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
        console.warn(`[WARN] 頻道狀態：${status}，5 秒後重連…`);
        setTimeout(subscribe, 5000);
      }
    });
}

// ──────────────────────────────────────────────────────────
// 啟動
// ──────────────────────────────────────────────────────────

console.log("=== print-bridge 啟動 ===");
console.log(`Supabase: ${SUPABASE_URL}`);
subscribe();

process.on("SIGINT", async () => {
  console.log("\n[STOP] 關閉中…");
  if (channel) await supabase.removeChannel(channel);
  process.exit(0);
});
