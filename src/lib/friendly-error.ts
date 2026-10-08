/** 把 API 的英文/技術錯誤轉成店員看得懂的中文。 */
const KNOWN: [RegExp, string][] = [
  [/unauthori[sz]ed/i, "登入已過期，請重新登入"],
  [/forbidden branch/i, "你的帳號不能操作這間分店"],
  [/forbidden/i, "你的帳號沒有權限做這件事"],
  [/not found/i, "找不到這筆資料，可能已被刪除，請重新整理"],
  [/missing required|required fields|invalid/i, "有欄位沒填或格式不對，請檢查後再試"],
  [/duplicate key|already exists|unique/i, "已有相同的資料，請換一個名稱或編號"],
  [/service_role|SUPABASE|migration|relation .* does not exist/i, "這個功能尚未開通，請聯絡工程人員"],
];

export function friendlyMessage(raw: unknown, status?: number): string {
  if (status === 401) return "登入已過期，請重新登入";
  if (status === 403) return "你的帳號沒有權限做這件事";
  if (status === 404) return "找不到這筆資料，請重新整理";
  if (status === 429) return "操作太頻繁，請稍等一下再試";
  if (typeof raw === "string") {
    // 已經是中文的訊息直接給店員看
    if (/[一-鿿]/.test(raw) && !/migration|SUPABASE|service_role/i.test(raw)) return raw;
    for (const [re, msg] of KNOWN) if (re.test(raw)) return msg;
  }
  if (status && status >= 500) return "系統暫時有問題，請稍後再試";
  return "操作失敗，請稍後再試";
}

/** 讀失敗的 Response，永遠不會 throw。 */
export async function responseError(res: Response): Promise<string> {
  let raw: unknown;
  try {
    const body = await res.clone().json();
    raw = body?.error ?? body?.message;
  } catch {
    // 非 JSON（例如 502 網頁）
  }
  return friendlyMessage(raw, res.status);
}

export function networkError(): string {
  return "連不上系統，請確認網路後再試";
}

export function isSessionExpired(res: Response): boolean {
  return res.status === 401;
}

/** catch 區塊用：我們自己丟的中文訊息照用，瀏覽器的英文錯誤（Failed to fetch）換成中文。 */
export function thrownMessage(err: unknown, fallback = "操作失敗，請稍後再試"): string {
  if (err instanceof Error && /[一-鿿]/.test(err.message)) return err.message;
  if (err instanceof TypeError) return networkError();
  return fallback;
}
