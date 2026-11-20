/**
 * LINE 底部選單（rich menu）：四格按鈕，接到聊天室訂位（line-booking-chat.ts）。
 * 圖片：public/line/richmenu.png（2500×843）。換圖只要換檔案，格子位置寫在下面。
 * 發布／移除走 /api/admin/line-richmenu（後台登入），不在本機碰 token。
 * @see docs/LINE.md
 */
import { LINE_SITE_URL } from "@/lib/line-flex";

const API = "https://api.line.me/v2/bot";
const DATA_API = "https://api-data.line.me/v2/bot";
export const RICH_MENU_NAME = "sunrise-main";
const WIDTH = 2500;
const HEIGHT = 843;

const postback = (label: string, data: string) => ({ type: "postback", label, data, displayText: label });
const cell = (x: number, width: number, action: Record<string, unknown>) => ({ bounds: { x, y: 0, width, height: HEIGHT }, action });

/** Postback data matches parseBookingPostback in line-booking-menu.ts. */
export function richMenuDefinition() {
  return {
    size: { width: WIDTH, height: HEIGHT },
    selected: true,
    name: RICH_MENU_NAME,
    chatBarText: "訂位・菜單",
    areas: [
      cell(0, 1000, postback("我要訂位", "a=book")),
      cell(1000, 500, postback("我的訂位", "a=mine")),
      cell(1500, 500, { type: "uri", label: "看菜單", uri: `${LINE_SITE_URL}/menu` }),
      cell(2000, 500, postback("店家資訊", "a=info")),
    ],
  };
}

async function line(token: string, method: string, url: string, body?: BodyInit, contentType = "application/json") {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": contentType } : {}) },
    body,
  });
  // Status only: LINE error bodies can echo request details, and this message reaches the admin response.
  if (!res.ok) throw new Error(`LINE ${method} ${new URL(url).pathname.replace(/[^/]{20,}/g, "…")} → ${res.status}`);
  return res;
}

/**
 * Create the menu, upload the image, then show it: to one user (trial) or to everyone (default).
 * A menu that could not be completed is deleted. Publishing to everyone also deletes our older menus.
 */
export async function publishRichMenu(token: string, userId?: string): Promise<string> {
  const image = await fetch(`${LINE_SITE_URL}/line/richmenu.png`);
  if (!image.ok) throw new Error(`rich menu image → ${image.status}`);
  const png = await image.arrayBuffer();

  const created = await line(token, "POST", `${API}/richmenu`, JSON.stringify(richMenuDefinition()));
  const { richMenuId } = (await created.json()) as { richMenuId: string };
  try {
    await line(token, "POST", `${DATA_API}/richmenu/${richMenuId}/content`, png, "image/png");
    await line(token, "POST", `${API}/user/${userId ?? "all"}/richmenu/${richMenuId}`);
  } catch (err) {
    await line(token, "DELETE", `${API}/richmenu/${richMenuId}`).catch(() => {});
    throw err;
  }
  if (!userId) {
    // The new menu is already live; a failed tidy-up must not be reported as a failed publish.
    try {
      const list = (await (await line(token, "GET", `${API}/richmenu/list`)).json()) as { richmenus?: { richMenuId: string; name: string }[] };
      for (const old of list.richmenus ?? []) {
        if (old.name === RICH_MENU_NAME && old.richMenuId !== richMenuId) {
          await line(token, "DELETE", `${API}/richmenu/${old.richMenuId}`).catch(() => {});
        }
      }
    } catch (err) {
      console.error("[line-richmenu] old menus not removed:", err instanceof Error ? err.message : err);
    }
  }
  return richMenuId;
}

/** Hide the menu again: for one user, or the account default. Menus set in LINE's own manager are untouched. */
export async function removeRichMenu(token: string, userId?: string): Promise<void> {
  await line(token, "DELETE", `${API}/user/${userId ?? "all"}/richmenu`);
}
