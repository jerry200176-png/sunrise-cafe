/**
 * 唯讀預覽：既有的餐點選項會被合併成哪些選項組。不寫入任何資料。
 *   npx tsx scripts/preview-option-set-merge.ts
 * 需要環境變數 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY（只做 SELECT）。
 * 沒有金鑰時，可改在 Supabase SQL Editor 貼上 supabase/preview-menu-option-set-merge.sql。
 */
import { createClient } from "@supabase/supabase-js";
import { planOptionSetMerge } from "../src/lib/option-set-merge";
import { readOptionPreview, renderOptionPreview } from "./lib/option-preview-reader";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("請設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY（只讀）");
  const db = createClient(url, key);
  const { rows, names } = await readOptionPreview(db);
  const plan = planOptionSetMerge(rows);
  console.log(renderOptionPreview(plan, names, process.argv.includes("--json")));
  console.error("這是目前資料的近似預覽，不是遷移前快照；跨頁不具一致快照，排序與數值也可能與 PostgreSQL 不同。請使用 SQL 核對。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
