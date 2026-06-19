import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "var(--font-display)", "serif"],
        display: ["var(--font-display)", "var(--font-serif)", "serif"],
      },
      // 注意：不覆寫 Tailwind 預設 amber/stone（既有頁面大量使用），僅新增品牌專屬色票
      colors: {
        paper: { DEFAULT: "#faf6ef", deep: "#f1e9da" },
        latte: "#e9dcc6",
        ink: { DEFAULT: "#2b2018", soft: "#5c4a3a", faint: "#9a8975" },
        caramel: { DEFAULT: "#c0832f", deep: "#9d6519", glow: "#f0c27a" },
      },
    },
  },
  plugins: [],
} satisfies Config;
