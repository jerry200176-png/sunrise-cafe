/**
 * LINE Flex Message — 共用 bubble 元件
 * 讓群組/客人通知以卡片形式呈現，取代純文字訊息
 */

export type LineFlexContainer = Record<string, unknown>;

export function flexHeader(emoji: string, title: string, bgColor: string): Record<string, unknown> {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: bgColor,
    paddingAll: "16px",
    contents: [
      { type: "text", text: `${emoji} ${title}`, color: "#FFFFFF", weight: "bold", size: "md" },
    ],
  };
}

export function flexRow(label: string, value: string): Record<string, unknown> {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, color: "#9A8C7A", size: "sm", flex: 2 },
      { type: "text", text: value, color: "#3D2B1F", size: "sm", flex: 5, wrap: true },
    ],
  };
}

export function flexButtonFooter(label: string, uri: string, color = "#D97706"): Record<string, unknown> {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      { type: "button", style: "primary", color, action: { type: "uri", label, uri } },
    ],
  };
}
