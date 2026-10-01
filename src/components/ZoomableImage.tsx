"use client";

import Image from "next/image";
import { useState } from "react";

/** 縮圖：點一下開全螢幕大圖，再點一下（或按 Esc）關閉。 */
export function ZoomableImage({ src, alt, className, sizes, unoptimized = false }: {
  src: string;
  alt: string;
  className: string;
  sizes: string;
  unoptimized?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-label={`放大${alt}圖片`} onClick={() => setOpen(true)} className={`relative block ${className}`}>
      <Image src={src} alt="" fill unoptimized={unoptimized} sizes={sizes} className="object-cover" />
    </button>
    {open && <button type="button" aria-label="關閉大圖" autoFocus onClick={() => setOpen(false)}
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4">
      <span className="relative h-[80vh] w-full"><Image src={src} alt={alt} fill unoptimized={unoptimized} sizes="100vw" className="object-contain" /></span>
      <span className="text-sm text-white">{alt}（點一下關閉）</span>
    </button>}
  </>;
}

export const MENU_PHOTO_NOTE = "圖片僅供參考，實際以現場出餐為準。";

/** 大安店菜單 banner（圖上印的是大安店地址電話，其他分店不顯示）。 */
// ponytail: 用分店名稱比對；分店多了再改成後台可上傳的 branches.menu_banner_url。
export function BranchMenuBanner({ branchName, className = "" }: { branchName?: string | null; className?: string }) {
  if (!branchName?.includes("大安")) return null;
  return <ZoomableImage src="/banners/daan.png" alt="昇咖啡大安店" sizes="(max-width: 640px) 100vw, 576px"
    className={`aspect-[1024/520] w-full overflow-hidden ${className}`} />;
}
