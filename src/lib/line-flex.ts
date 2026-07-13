/**
 * LINE Flex Message — 昇咖啡品牌卡片元件（Warm Artisan · inline 風格資訊層級）
 * @see DESIGN.md · docs/LINE.md
 */

export type LineFlexContainer = Record<string, unknown>;

/** 品牌色（對齊 DESIGN.md） */
export const LINE_BRAND = {
  caramel: "#C0832F",
  caramelDeep: "#9D6519",
  ink: "#2B2018",
  inkSoft: "#5C4A3A",
  label: "#9A8975",
  paper: "#FAF6EF",
  success: "#2F6B4F",
  successBright: "#16A34A",
  warning: "#C0832F",
  danger: "#9B2C2C",
  heroGradient: "#B5742C",
} as const;

export const LINE_SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
  "https://sunrise-cafe-six.vercel.app";

export const LINE_QUERY_URL = `${LINE_SITE_URL}/book/query`;
export const LINE_BOOK_URL = `${LINE_SITE_URL}/book`;

export type FlexRow = { label: string; value: string };

export type FlexBubbleOptions = {
  /** 標題列左側圖示（emoji 或單字） */
  icon?: string;
  title: string;
  subtitle?: string;
  accentColor?: string;
  rows?: FlexRow[];
  paragraphs?: string[];
  note?: string;
  primaryAction?: { label: string; uri: string; color?: string };
  secondaryAction?: { label: string; uri: string };
  /** 是否顯示底部「開啟官網」連結（類 inline 小站入口） */
  showSiteLink?: boolean;
};

export function flexRow(label: string, value: string): Record<string, unknown> {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, color: LINE_BRAND.label, size: "sm", flex: 2 },
      { type: "text", text: value, color: LINE_BRAND.ink, size: "sm", flex: 5, wrap: true, weight: "bold" },
    ],
  };
}

function flexHero(icon: string, title: string, subtitle: string | undefined, accent: string) {
  const contents: Record<string, unknown>[] = [
    {
      type: "box",
      layout: "horizontal",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 0,
          width: "40px",
          height: "40px",
          cornerRadius: "20px",
          backgroundColor: "#FFFFFF33",
          justifyContent: "center",
          alignItems: "center",
          contents: [{ type: "text", text: icon, size: "lg", align: "center", gravity: "center" }],
        },
        {
          type: "box",
          layout: "vertical",
          flex: 1,
          paddingStart: "12px",
          contents: [
            { type: "text", text: title, color: "#FFFFFF", weight: "bold", size: "md", wrap: true },
            ...(subtitle
              ? [{ type: "text", text: subtitle, color: "#FFFFFFCC", size: "xs", margin: "xs", wrap: true }]
              : []),
          ],
        },
      ],
    },
  ];
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: accent,
    paddingAll: "18px",
    contents,
  };
}

function flexFooterActions(
  primary?: FlexBubbleOptions["primaryAction"],
  secondary?: FlexBubbleOptions["secondaryAction"],
  showSiteLink?: boolean
): Record<string, unknown> | undefined {
  const buttons: Record<string, unknown>[] = [];
  if (primary) {
    buttons.push({
      type: "button",
      style: "primary",
      color: primary.color ?? LINE_BRAND.caramelDeep,
      height: "sm",
      action: { type: "uri", label: primary.label, uri: primary.uri },
    });
  }
  if (secondary) {
    buttons.push({
      type: "button",
      style: "secondary",
      height: "sm",
      color: LINE_BRAND.paper,
      action: { type: "uri", label: secondary.label, uri: secondary.uri },
    });
  }
  if (showSiteLink && !secondary) {
    buttons.push({
      type: "button",
      style: "link",
      height: "sm",
      action: { type: "uri", label: "開啟昇咖啡官網", uri: LINE_SITE_URL },
    });
  }
  if (buttons.length === 0) return undefined;
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    paddingAll: "12px",
    contents: buttons,
  };
}

/** 統一 bubble 版型 — 所有客人/群組通知應使用此函式 */
export function flexBubble(opts: FlexBubbleOptions): LineFlexContainer {
  const accent = opts.accentColor ?? LINE_BRAND.caramel;
  const bodyContents: Record<string, unknown>[] = [];

  if (opts.paragraphs?.length) {
    for (const p of opts.paragraphs) {
      bodyContents.push({
        type: "text",
        text: p,
        size: "sm",
        color: LINE_BRAND.ink,
        wrap: true,
        weight: "bold",
      });
    }
  }

  if (opts.rows?.length) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      spacing: "sm",
      margin: bodyContents.length ? "md" : "none",
      contents: opts.rows.map((r) => flexRow(r.label, r.value)),
    });
  }

  if (opts.note) {
    bodyContents.push({
      type: "text",
      text: opts.note,
      size: "xs",
      color: LINE_BRAND.label,
      wrap: true,
      margin: "md",
    });
  }

  return {
    type: "bubble",
    size: "mega",
    header: flexHero(opts.icon ?? "☕", opts.title, opts.subtitle, accent),
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: LINE_BRAND.paper,
      paddingAll: "16px",
      contents: bodyContents.length ? bodyContents : [{ type: "filler" }],
    },
    footer: flexFooterActions(opts.primaryAction, opts.secondaryAction, opts.showSiteLink),
  };
}

/** @deprecated 使用 flexBubble */
export function flexHeader(emoji: string, title: string, bgColor: string): Record<string, unknown> {
  return flexHero(emoji, title, undefined, bgColor);
}

/** @deprecated 使用 flexBubble primaryAction */
export function flexButtonFooter(label: string, uri: string, color = LINE_BRAND.caramelDeep): Record<string, unknown> {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      { type: "button", style: "primary", color, height: "sm", action: { type: "uri", label, uri } },
    ],
  };
}
