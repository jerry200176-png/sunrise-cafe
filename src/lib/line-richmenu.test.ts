import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBookingPostback } from "./line-booking-menu";
import { publishRichMenu, removeRichMenu, richMenuDefinition, RICH_MENU_NAME } from "./line-richmenu";

type Call = { method: string; url: string };
function stubLine(fail?: (c: Call) => boolean) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const call = { method: init?.method ?? "GET", url: String(url) };
    calls.push(call);
    if (fail?.(call)) return new Response("secret detail", { status: 400 });
    if (call.url.endsWith("/richmenu") && call.method === "POST") return Response.json({ richMenuId: "richmenu-new" });
    if (call.url.endsWith("/richmenu/list")) return Response.json({ richmenus: [
      { richMenuId: "richmenu-new", name: RICH_MENU_NAME }, { richMenuId: "richmenu-old", name: RICH_MENU_NAME }, { richMenuId: "richmenu-manual", name: "made in LINE manager" },
    ] });
    return new Response("{}", { status: 200 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("richMenuDefinition", () => {
  it("tiles the whole image with four cells that the booking chat understands", () => {
    const { size, areas } = richMenuDefinition();
    let x = 0;
    for (const { bounds } of areas) {
      expect(bounds).toMatchObject({ x, y: 0, height: size.height });
      x += bounds.width;
    }
    expect(x).toBe(size.width);
    const steps = areas.filter((a) => a.action.type === "postback").map((a) => parseBookingPostback(String(a.action.data)));
    expect(steps).toEqual([{ a: "book" }, { a: "mine" }, { a: "info" }]);
    expect(areas.map((a) => a.action.label)).toEqual(["我要訂位", "我的訂位", "看菜單", "店家資訊"]);
  });
});

describe("publishRichMenu", () => {
  it("trial: links the new menu to one user and deletes nothing", async () => {
    const calls = stubLine();
    expect(await publishRichMenu("tok", "U" + "a".repeat(32))).toBe("richmenu-new");
    expect(calls.map((c) => c.method + " " + new URL(c.url).pathname)).toEqual([
      "GET /line/richmenu.png",
      "POST /v2/bot/richmenu",
      "POST /v2/bot/richmenu/richmenu-new/content",
      `POST /v2/bot/user/U${"a".repeat(32)}/richmenu/richmenu-new`,
    ]);
  });

  it("everyone: sets the default and deletes only our older menu", async () => {
    const calls = stubLine();
    await publishRichMenu("tok");
    const paths = calls.map((c) => c.method + " " + new URL(c.url).pathname);
    expect(paths).toContain("POST /v2/bot/user/all/richmenu/richmenu-new");
    expect(paths.filter((p) => p.startsWith("DELETE"))).toEqual(["DELETE /v2/bot/richmenu/richmenu-old"]);
  });

  it("deletes a half-made menu when the image upload fails, without leaking LINE's reply", async () => {
    const calls = stubLine((c) => c.url.includes("/content"));
    await expect(publishRichMenu("tok")).rejects.toThrow(/→ 400$/);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: expect.stringContaining("/richmenu/richmenu-new") });
    expect(calls.some((c) => c.url.includes("/user/"))).toBe(false);
  });
});

describe("removeRichMenu", () => {
  it("unsets the default without deleting menus", async () => {
    const calls = stubLine();
    await removeRichMenu("tok");
    expect(calls).toEqual([{ method: "DELETE", url: "https://api.line.me/v2/bot/user/all/richmenu" }]);
  });
});
