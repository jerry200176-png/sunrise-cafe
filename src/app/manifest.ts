import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "昇咖啡 Sunrise Café",
    short_name: "昇咖啡",
    description: "沐浴在晨光裡的精品咖啡館 — 包廂租借、自助點餐、LINE 即時通知",
    start_url: "/",
    display: "standalone",
    background_color: "#faf6ef",
    theme_color: "#9d6519",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon.webp", sizes: "192x192", type: "image/webp" },
      { src: "/icon.webp", sizes: "512x512", type: "image/webp" },
      { src: "/apple-icon.webp", sizes: "180x180", type: "image/webp" },
    ],
  };
}
