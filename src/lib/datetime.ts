/**
 * 日期 / 時區工具
 *
 * Vercel 伺服器以 UTC 執行，顯示時間前必須轉成台灣時區，
 * 否則會出現少 8 小時的錯誤（歷史上已多次出包）。
 */

/**
 * 將任意可解析的時間字串轉成「台灣時區當地時間」的 Date。
 *
 * 原理：先以 UTC 解析原字串，再用 toLocaleString 取得台灣當地的
 * 牆上時間字串，最後重新建立 Date。回傳的 Date 其 getHours() 等
 * 方法即為台灣當地時間，可直接交給 date-fns 的 format 使用。
 */
export function toTaipei(s: string): Date {
  return new Date(new Date(s).toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}
