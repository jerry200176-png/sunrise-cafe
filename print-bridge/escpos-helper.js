/**
 * 將訂單資料格式化為廚房工單文字
 * @param {object} order - orders row（含 table, order_items）
 * @returns {string[]} 每行文字
 */
function formatTicket(order) {
  const lines = [];
  const SEP = "================================";
  const THIN = "--------------------------------";

  const now = new Date();
  const timeStr = now.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Taipei",
  });

  const shortId = order.id.slice(0, 8).toUpperCase();
  const tableNum = order.table?.number ?? "—";

  lines.push(SEP);
  lines.push("        廚房工單");
  lines.push(SEP);
  lines.push(`桌號：${tableNum}          #${shortId}`);
  lines.push(`時間：${timeStr}`);
  lines.push(THIN);

  (order.order_items ?? []).forEach((item) => {
    const optStr =
      Array.isArray(item.selected_options) && item.selected_options.length > 0
        ? item.selected_options.map((o) => o.name).join(" / ")
        : null;
    lines.push(`x${item.quantity}  ${item.item_name}`);
    if (optStr) lines.push(`    ${optStr}`);
    if (item.special_notes) lines.push(`    備註：${item.special_notes}`);
  });

  lines.push(THIN);

  if (order.notes) {
    lines.push(`整體備註：${order.notes}`);
    lines.push(THIN);
  }

  lines.push(`合計：$${order.total_amount}（到櫃台結帳）`);
  lines.push(SEP);
  lines.push(""); // 空行讓紙張前進

  return lines;
}

module.exports = { formatTicket };
