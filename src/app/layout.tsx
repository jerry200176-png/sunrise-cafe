import type { Metadata, Viewport } from "next";
import { Fraunces, Noto_Serif_TC, Noto_Sans_TC } from "next/font/google";
import "./globals.css";

// 顯示用襯線（拉丁）：柔潤、有溫度，適合手作咖啡的調性
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  axes: ["SOFT", "opsz"],
});

// 中文標題襯線
const notoSerifTC = Noto_Serif_TC({
  weight: ["400", "600", "700", "900"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
});

// 內文無襯線
const notoSansTC = Noto_Sans_TC({
  weight: ["300", "400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "昇咖啡 · 包廂租借預約",
  description: "昇咖啡包廂租借訂位系統 — 線上預約包廂、自助點餐、LINE 即時通知。",
  appleWebApp: {
    capable: true,
    title: "昇咖啡",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#faf6ef",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className={`${fraunces.variable} ${notoSerifTC.variable} ${notoSansTC.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
