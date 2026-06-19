/**
 * 後台驗證金鑰解析（同時供 login route 與 middleware 使用）
 *
 * - ADMIN_PASSWORD：登入密碼（驗證使用者輸入）
 * - SESSION_SECRET：session cookie 的 HMAC 簽章金鑰
 *
 * 兩者分離可避免「密碼即金鑰」：更換登入密碼不會讓既有 session 失效，
 * 簽章金鑰也不必是人類記得住的密碼。未設定 SESSION_SECRET 時向下相容，
 * 沿用 ADMIN_PASSWORD 當簽章金鑰（與舊行為一致）。
 */
export function getSessionSecret(): string | undefined {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || undefined;
}
