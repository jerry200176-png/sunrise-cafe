/**
 * 經營總覽「建議決策」：純規則，沒有 AI。輸入一份指標快照，輸出依估計金額排序的建議。
 * 每個建議都附上它依據的數字和要去哪個設定頁調整；系統不會自動改任何設定。
 * 估計金額是「近 4 週」的粗估，用來排序，不是承諾。
 */

export const MIN_WEEKS = 4;
export const MIN_BOOKINGS = 20;
/** 預點餐每筆預估增加的餐費（粗估，只用來排序）。 */
export const PREORDER_NT = 150;

export type AdviceCategory = "deposit" | "slots" | "menu" | "rooms" | "retention" | "branches";

export const CATEGORY_LABELS: Record<AdviceCategory, string> = {
  deposit: "訂金／放鳥",
  slots: "時段／人手",
  menu: "菜單",
  rooms: "包廂／桌位",
  retention: "回客／行銷",
  branches: "分店比較",
};

export type BranchMetrics = {
  branchId: string;
  branchName: string;
  /** 有效訂位（不含已取消） */
  bookings: number;
  cancelled: number;
  /** 取消時訂金還沒付 */
  cancelledUnpaid: number;
  /** 只算店員標記「沒來」的 */
  noShows: number;
  depositPaid: number;
  avgPrice: number;
  /** 台北時間 0–23 點的有效訂位數 */
  hourBookings: number[];
  rooms: Array<{ id: string; name: string; bookings: number }>;
  uniqueGuests: number;
  repeatGuests: number;
  preorderBookings: number;
};

export type AdviceInput = {
  /** 有資料的週數（最早一筆訂位到現在） */
  weeksCovered: number;
  branches: BranchMetrics[];
};

export type Suggestion = {
  /** 穩定 id：規則 + 分店，採用/略過靠它記錄 */
  id: string;
  category: AdviceCategory;
  branchId: string | null;
  title: string;
  why: string;
  numbers: Array<{ label: string; value: string }>;
  impactNt: number;
  href: string;
};

/** 店員對某個建議按下的決定，連同當下的數字。 */
export type Decision = {
  suggestionId: string;
  decision: "adopted" | "skipped";
  decidedAt: string;
  snapshot: { title: string; numbers: Suggestion["numbers"]; impactNt: number };
};

/** 已採用的建議：滿 4 週後給出前後對照；建議不再出現 = 已改善。 */
export type AdoptedView = {
  suggestionId: string;
  title: string;
  decidedAt: string;
  before: Suggestion["numbers"];
  /** 還不到 4 週為 null */
  after: { resolved: boolean; numbers: Suggestion["numbers"] } | null;
  daysLeft: number;
};

export type AdviceResult =
  | { enough: false; weeksToWait: number; bookings: number; weeksCovered: number }
  | { enough: true; top: Suggestion[]; more: Suggestion[]; adopted?: AdoptedView[] };

const pct = (n: number) => `${Math.round(n * 100)}%`;
const nt = (n: number) => `NT$${Math.round(n).toLocaleString("zh-TW")}`;
const rate = (a: number, b: number) => (b > 0 ? a / b : 0);

type Rule = (b: BranchMetrics) => Omit<Suggestion, "id" | "branchId" | "category"> | null;

const DEPOSIT_PAGE = "/admin/payments";

const RULES: Array<{ key: string; category: AdviceCategory; run: Rule }> = [
  {
    key: "no-show",
    category: "deposit",
    run: (b) => {
      const r = rate(b.noShows, b.bookings);
      if (b.noShows < 2 || r < 0.05) return null;
      return {
        title: "放鳥偏多，考慮提高訂金或加強到店前確認",
        why: "被標記「沒來」的訂位，座位當天賣不出去。",
        numbers: [{ label: "沒來", value: `${b.noShows} 筆（${pct(r)}）` }, { label: "平均每筆", value: nt(b.avgPrice) }],
        impactNt: b.noShows * b.avgPrice,
        href: DEPOSIT_PAGE,
      };
    },
  },
  {
    key: "unpaid-cancel",
    category: "deposit",
    run: (b) => {
      const r = rate(b.cancelledUnpaid, b.bookings + b.cancelled);
      if (b.cancelledUnpaid < 3 || r < 0.15) return null;
      return {
        title: "很多訂位沒付訂金就取消，考慮縮短付款期限",
        why: "沒付訂金的位子會一直佔著，最後才釋出，來不及補單。",
        numbers: [{ label: "未付訂金就取消", value: `${b.cancelledUnpaid} 筆（${pct(r)}）` }, { label: "平均每筆", value: nt(b.avgPrice) }],
        impactNt: b.cancelledUnpaid * b.avgPrice * 0.5,
        href: DEPOSIT_PAGE,
      };
    },
  },
  {
    key: "deposit-rate",
    category: "deposit",
    run: (b) => {
      const r = rate(b.depositPaid, b.bookings);
      if (b.bookings < MIN_BOOKINGS || r >= 0.75) return null;
      const unpaid = b.bookings - b.depositPaid;
      return {
        title: "訂金收款率偏低，檢查提醒與收款方式",
        why: "訂金收款率低於 75% 目標。",
        numbers: [{ label: "已付訂金", value: `${b.depositPaid} / ${b.bookings}（${pct(r)}）` }],
        impactNt: unpaid * b.avgPrice * 0.3,
        href: DEPOSIT_PAGE,
      };
    },
  },
  {
    key: "off-peak",
    category: "slots",
    run: (b) => {
      const peak = Math.max(...b.hourBookings);
      if (peak < 5) return null;
      const quiet = b.hourBookings.map((n, h) => ({ h, n })).filter(({ n }) => n > 0 && n <= peak * 0.25);
      if (quiet.length === 0) return null;
      const gain = quiet.reduce((s, { n }) => s + (peak * 0.5 - n), 0);
      const peakHour = b.hourBookings.indexOf(peak);
      return {
        title: "離峰時段很空，考慮離峰優惠或調整人手",
        why: "同一間店，尖峰時段訂位是離峰的 4 倍以上。",
        numbers: [
          { label: "尖峰", value: `${peakHour}:00 共 ${peak} 筆` },
          { label: "偏空時段", value: quiet.map(({ h, n }) => `${h}:00（${n}）`).join("、") },
        ],
        impactNt: gain * b.avgPrice,
        href: "/admin/system",
      };
    },
  },
  {
    key: "preorder",
    category: "menu",
    run: (b) => {
      const r = rate(b.preorderBookings, b.bookings);
      if (b.bookings < MIN_BOOKINGS || r >= 0.2) return null;
      return {
        title: "很少客人預先點餐，在訂位流程多推一下",
        why: "預點餐能提早備料，也提高客單。",
        numbers: [{ label: "有預點餐", value: `${b.preorderBookings} / ${b.bookings}（${pct(r)}）` }],
        impactNt: Math.max(0, b.bookings * (0.3 - r)) * PREORDER_NT,
        href: "/admin/menu",
      };
    },
  },
  {
    key: "room-imbalance",
    category: "rooms",
    run: (b) => {
      if (b.rooms.length < 2 || b.bookings < MIN_BOOKINGS) return null;
      const sorted = [...b.rooms].sort((x, y) => y.bookings - x.bookings);
      const top = sorted[0];
      const low = sorted[sorted.length - 1];
      if (rate(top.bookings, b.bookings) < 0.5 || low.bookings > top.bookings * 0.25) return null;
      const avg = b.bookings / b.rooms.length;
      return {
        title: `「${low.name}」很少被訂，考慮調整定價或推廣`,
        why: `「${top.name}」佔了一半以上的訂位。`,
        numbers: [
          { label: top.name, value: `${top.bookings} 筆（${pct(rate(top.bookings, b.bookings))}）` },
          { label: low.name, value: `${low.bookings} 筆` },
        ],
        impactNt: Math.max(0, avg - low.bookings) * b.avgPrice * 0.5,
        href: "/admin/system",
      };
    },
  },
  {
    key: "repeat",
    category: "retention",
    run: (b) => {
      const r = rate(b.repeatGuests, b.uniqueGuests);
      if (b.bookings < MIN_BOOKINGS || b.uniqueGuests < 10 || r >= 0.2) return null;
      return {
        title: "回頭客偏少，考慮訂位後的 LINE 回訪或回客優惠",
        why: "以訂位電話算，訂過兩次以上的客人比例偏低。",
        numbers: [{ label: "回頭客", value: `${b.repeatGuests} / ${b.uniqueGuests} 人（${pct(r)}）` }],
        impactNt: b.uniqueGuests * (0.25 - r) * b.avgPrice,
        href: "/admin/system",
      };
    },
  },
];

function compareBranches(branches: BranchMetrics[]): Suggestion[] {
  if (branches.length < 2) return [];
  const best = [...branches].sort((a, b) => b.bookings - a.bookings)[0];
  const out: Suggestion[] = [];
  for (const b of branches) {
    if (b === best || best.bookings < MIN_BOOKINGS || b.bookings >= best.bookings * 0.6) continue;
    out.push({
      id: `branch-gap:${b.branchId}`,
      category: "branches",
      branchId: b.branchId,
      title: `${b.branchName} 訂位明顯比 ${best.branchName} 少，檢查時段與宣傳`,
      why: "兩間店近 4 週的訂位數差距很大。",
      numbers: [
        { label: best.branchName, value: `${best.bookings} 筆` },
        { label: b.branchName, value: `${b.bookings} 筆` },
      ],
      impactNt: (best.bookings * 0.8 - b.bookings) * (b.avgPrice || best.avgPrice),
      href: "/admin/dashboard",
    });
  }
  return out;
}

export function buildAdvice(input: AdviceInput, topN = 3): AdviceResult {
  const bookings = input.branches.reduce((s, b) => s + b.bookings, 0);
  const weeksCovered = Math.max(0, Math.floor(input.weeksCovered));
  if (weeksCovered < MIN_WEEKS || bookings < MIN_BOOKINGS) {
    const perWeek = Math.max(1, bookings / Math.max(1, input.weeksCovered));
    const forBookings = bookings < MIN_BOOKINGS ? Math.ceil((MIN_BOOKINGS - bookings) / perWeek) : 0;
    return { enough: false, bookings, weeksCovered, weeksToWait: Math.max(1, MIN_WEEKS - weeksCovered, forBookings) };
  }
  const many = input.branches.length > 1;
  const all: Suggestion[] = [];
  for (const b of input.branches) {
    for (const rule of RULES) {
      const s = rule.run(b);
      if (!s || !(s.impactNt > 0)) continue;
      all.push({
        ...s,
        id: `${rule.key}:${b.branchId}`,
        category: rule.category,
        branchId: b.branchId,
        title: many ? `${b.branchName}：${s.title}` : s.title,
      });
    }
  }
  all.push(...compareBranches(input.branches));
  all.sort((a, b) => b.impactNt - a.impactNt || a.id.localeCompare(b.id));
  return { enough: true, top: all.slice(0, topN), more: all.slice(topN) };
}

const OUTCOME_DAYS = 28;

/** 把店員的採用／略過套上去：略過的不再出現；採用的移到「已採用」，滿 4 週給前後對照。 */
export function applyDecisions(result: AdviceResult, decisions: Decision[], now = new Date(), topN = 3): AdviceResult {
  if (!result.enough) return result;
  const all = [...result.top, ...result.more];
  const decided = new Map(decisions.map((d) => [d.suggestionId, d]));
  const open = all.filter((s) => !decided.has(s.id));
  const adopted: AdoptedView[] = decisions
    .filter((d) => d.decision === "adopted")
    .map((d) => {
      const days = Math.floor((now.getTime() - new Date(d.decidedAt).getTime()) / 86_400_000);
      const current = all.find((s) => s.id === d.suggestionId);
      return {
        suggestionId: d.suggestionId,
        title: d.snapshot.title,
        decidedAt: d.decidedAt,
        before: d.snapshot.numbers,
        after: days >= OUTCOME_DAYS ? { resolved: !current, numbers: current?.numbers ?? [] } : null,
        daysLeft: Math.max(0, OUTCOME_DAYS - days),
      };
    });
  return { enough: true, top: open.slice(0, topN), more: open.slice(topN), adopted };
}
