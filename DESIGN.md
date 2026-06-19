# 昇咖啡 DESIGN.md

> 供 AI agent 與開發者參考的設計系統文件，產出視覺一致的 UI。
> 格式參考 [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)。

## 1. Visual Atmosphere（視覺氛圍）

一間沐浴在晨光裡的精品咖啡館。溫暖、安靜、不急躁。**Warm Artisan Editorial**：
奶油紙感的底、濃縮咖啡般的墨色、灑落的焦糖晨光。留白慷慨、襯線標題帶手作溫度、
互動克制而細緻。避免冷調、避免科技感、避免高彩度。

## 2. Color System（色彩）

| Token | Hex | 角色 |
|---|---|---|
| `paper` | `#faf6ef` | 主背景（紙） |
| `paper-deep` | `#f1e9da` | 次要表面、按鈕底 |
| `latte` | `#e9dcc6` | 分隔、淡色塊 |
| `ink` | `#2b2018` | 主文字（濃縮咖啡墨） |
| `ink-soft` | `#5c4a3a` | 次要文字 |
| `ink-faint` | `#9a8975` | 輔助說明、footer |
| `caramel` | `#c0832f` | 主 accent（焦糖） |
| `caramel-deep` | `#9d6519` | accent 深色、文字上的 accent |
| `caramel-glow` | `#f0c27a` | 晨光光暈 |

- 以 CSS 變數定義於 `globals.css`，並映射至 Tailwind（`text-ink`、`bg-paper`、`text-caramel-deep`…）。
- **不覆寫** Tailwind 預設 `amber` / `stone`（後台與訂位頁大量沿用）。
- 主行動用焦糖漸層 `linear-gradient(135deg,#b5742c,#9d6519)`，其餘用紙白卡片。

## 3. Typography（字體層級）

| 用途 | 字體 | 來源 |
|---|---|---|
| 拉丁顯示／品牌字 | **Fraunces**（柔潤光學襯線） | `--font-display` |
| 中文標題 | **Noto Serif TC** | `--font-serif` |
| 內文 | **Noto Sans TC** | `--font-sans` |

- 品牌中文字（昇咖啡）大字 + 寬字距 `tracking-[0.3em]`。
- 英文小標 small-caps 風格：`uppercase tracking-[0.4em]`。
- 標題一律襯線（`h1/h2/h3` 預設套 `--font-serif`），內文無襯線。

## 4. Components（元件）

- **主要按鈕**：焦糖漸層、圓角 `rounded-[1.4rem]`、柔和投影、hover 上浮 `-translate-y-0.5`，內含圓形圖示 + 標題 + 副標 + 右上箭頭。
- **次要按鈕**：紙白半透明 `bg-white/70`、細邊 `border-ink/10`、backdrop-blur、hover 邊框轉焦糖。
- **特色卡**：`bg-white/50` + 細邊 + 置中圖示（`strokeWidth={1.5}`）+ 襯線標題 + 灰字說明。
- 圖示統一用 lucide-react，線重 1.5。

## 5. Spacing & Grid

- 行動優先單欄 `max-w-md`，桌機放寬至 `max-w-xl`，置中。
- 區塊間距大（`mt-12`～`mt-14`），段落呼吸感優先於密度。

## 6. Shadow / Depth

- 主行動：暖色長投影 `0_10px_30px_-12px_rgba(157,101,25,0.45)`。
- 卡片：`shadow-sm`，避免硬黑陰影；深度靠暖色與透明度堆疊。

## 7. Motion

- 進場 `.rise`（由下淡入）+ `animation-delay` 交錯（每階 ~100ms）。
- 晨光 `.sun-breathe` 緩慢呼吸（9s）。
- 全部尊重 `prefers-reduced-motion`。

## 8. Texture & Atmosphere

- `body` 疊兩道 radial-gradient 晨光（右上暖、左下淡焦糖）。
- `.grain` 疊極淡 SVG 顆粒雜訊（opacity 0.035），營造紙感。

## 9. Do / Don't

- ✅ 襯線標題、寬字距品牌字、暖色光暈、慷慨留白。
- ✅ 焦糖作為唯一鮮明 accent，其餘維持紙與墨。
- ❌ 冷色／藍紫漸層／純黑陰影／高彩度。
- ❌ 用 Inter/Roboto/系統字當標題；標題請用襯線。

## 10. Agent Quick Prompt

> 「昇咖啡」風格：奶油紙底 `#faf6ef`、咖啡墨字 `#2b2018`、焦糖 accent `#c0832f`，
> 標題用 Noto Serif TC / Fraunces 襯線、內文 Noto Sans TC，暖色晨光光暈 + 細顆粒紙紋，
> 留白大、互動克制、進場由下淡入交錯。溫暖手作，不要科技冷調。
