import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co', // 直接允許所有 supabase 子網域
      },
    ],
  },
};

export default nextConfig;