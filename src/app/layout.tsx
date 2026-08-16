import type { Metadata, Viewport } from "next";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "昇咖啡 · 包廂租借預約",
  description: "昇咖啡包廂租借訂位系統 — 線上預約包廂、自助點餐、LINE 即時通知。",
  metadataBase: new URL("https://sunrise-cafe-six.vercel.app"),
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "昇咖啡 · 包廂租借預約",
    description: "沐浴在晨光裡的精品咖啡館 — 包廂租借、自助點餐、LINE 即時通知",
    url: "https://sunrise-cafe-six.vercel.app",
    siteName: "昇咖啡 Sunrise Café",
    locale: "zh_TW",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "昇咖啡 · 包廂租借預約",
    description: "沐浴在晨光裡的精品咖啡館 — 包廂租借、自助點餐、LINE 即時通知",
  },
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
    <html lang="zh-TW">
      <body className="antialiased">
        <a href="#main-content" className="skip-link">
          跳到主要內容
        </a>
        <LocaleProvider>
          <div id="main-content">{children}</div>
        </LocaleProvider>
      </body>
    </html>
  );
}
