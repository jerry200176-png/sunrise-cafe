/**
 * 店內平面圖（公分座標）＋把系統包廂對應到平面圖位置。
 *
 * 座標：u = 沿靠窗外牆的距離（從教室1 那端起算），v = 離窗的深度（往店內）。
 * 數字來源：平面圖標註尺寸（202／211／218／226／434 cm）與面積反推深度
 * （例：教室1 5.89㎡ ÷ 2.02m = 2.92m）；櫃台／茶水區／廁所／辦公室位置（大概位置即可）
 * 取自 OpenCV 在平面圖照片上偵測到的牆線，依比例換算。
 */
export type Rect = { u: number; v: number; w: number; d: number };

export type PlanRoom = {
  slot: string;
  /** 平面圖上的名稱（系統沒有對照時顯示用） */
  planName: string;
  /** 系統包廂名稱（完全相同才算）；空陣列 = 依順序自動對應 */
  names: string[];
  rect: Rect;
  /** 會議室：容納人數最多的包廂優先放這裡 */
  meeting?: boolean;
};

export type Landmark = {
  id: string;
  label: string;
  rect: Rect;
  kind: "counter" | "zone" | "service" | "entrance";
  /** 立體高度（公分），0 = 平面 */
  height: number;
};

export type FloorPlan = {
  id: string;
  /** 分店名稱包含任一關鍵字就套用 */
  branchKeywords: string[];
  size: { u: number; v: number };
  rooms: PlanRoom[];
  landmarks: Landmark[];
  /** 從哪一側看：站在櫃台往窗戶看 */
  viewFrom: "counter";
};

const R = (u: number, v: number, w: number, d: number): Rect => ({ u, v, w, d });

export const DAAN_FLOOR_PLAN: FloorPlan = {
  id: "daan",
  branchKeywords: ["大安"],
  size: { u: 1291, v: 903 },
  viewFrom: "counter",
  rooms: [
    { slot: "room1", planName: "教室1", names: ["包廂1"], rect: R(0, 0, 202, 292) },
    { slot: "room2", planName: "教室2", names: ["包廂2"], rect: R(202, 0, 211, 292) },
    { slot: "room3", planName: "教室3", names: ["包廂3"], rect: R(413, 113, 218, 179) },
    { slot: "room4", planName: "教室4", names: ["包廂4"], rect: R(631, 113, 226, 179) },
    { slot: "room5", planName: "會議室", names: ["會議室"], rect: R(857, 0, 434, 331), meeting: true },
  ],
  landmarks: [
    { id: "rest", label: "休息區", kind: "zone", rect: R(0, 300, 220, 380), height: 0 },
    { id: "counter", label: "櫃台", kind: "counter", rect: R(404, 589, 291, 100), height: 95 },
    { id: "tea", label: "茶水區", kind: "zone", rect: R(351, 700, 520, 203), height: 0 },
    { id: "toilet", label: "廁所", kind: "service", rect: R(900, 340, 347, 152), height: 0 },
    { id: "office", label: "辦公室", kind: "service", rect: R(941, 510, 306, 323), height: 0 },
    { id: "entrance", label: "入口", kind: "entrance", rect: R(100, 686, 120, 30), height: 0 },
  ],
};

export const FLOOR_PLANS: FloorPlan[] = [DAAN_FLOOR_PLAN];

export function floorPlanForBranch(branchName: string | null | undefined, plans: FloorPlan[] = FLOOR_PLANS): FloorPlan | null {
  if (!branchName) return null;
  return plans.find((plan) => plan.branchKeywords.some((keyword) => branchName.includes(keyword))) ?? null;
}

const CN_DIGITS: Record<string, string> = { 〇: "0", 零: "0", 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };

/** 名稱比對前先統一：去掉空白、全形數字與國字數字轉成半形數字。「包廂 1」「包廂１」「包廂一」都算「包廂1」。 */
export function normalizeRoomName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, "").replace(/[〇零一二三四五六七八九]/g, (c) => CN_DIGITS[c]);
}

/**
 * 系統包廂 → 平面圖位置。
 * 1) 名稱完全相同 2) 剩下的：人數最多的放會議室，其餘依名稱排序填入。
 * 包廂數對不上平面圖時回 null（改用自動排列，不硬塞）。
 */
export function assignRoomsToPlan<T extends { id: string; name: string; capacity: number }>(
  plan: FloorPlan,
  rooms: T[]
): Map<string, PlanRoom> | null {
  if (rooms.length !== plan.rooms.length) return null;
  const result = new Map<string, PlanRoom>();
  const freeSlots = [...plan.rooms];
  const take = (slot: PlanRoom) => freeSlots.splice(freeSlots.indexOf(slot), 1);

  for (const room of rooms) {
    const name = normalizeRoomName(room.name);
    const slot = freeSlots.find((candidate) => candidate.names.some((n) => normalizeRoomName(n) === name));
    if (slot) { result.set(room.id, slot); take(slot); }
  }
  const rest = rooms.filter((room) => !result.has(room.id)).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  const meetingSlot = freeSlots.find((slot) => slot.meeting);
  if (meetingSlot && rest.length) {
    const biggest = rest.reduce((max, room) => (room.capacity > max.capacity ? room : max));
    result.set(biggest.id, meetingSlot); take(meetingSlot);
    rest.splice(rest.indexOf(biggest), 1);
  }
  rest.forEach((room, index) => result.set(room.id, freeSlots[index]));
  return result;
}

/**
 * 平面圖座標（公分）→ 3D 場景座標（公尺）。站在櫃台往窗戶看：
 * 窗戶在畫面後方（z 小），教室1 在右手邊（u=0 → x 最大）。
 */
export function planToScene(plan: FloorPlan, rect: Rect): { x: number; z: number; width: number; depth: number } {
  const width = rect.w / 100;
  const depth = rect.d / 100;
  const x = (plan.size.u - (rect.u + rect.w / 2)) / 100 - plan.size.u / 200;
  const z = (rect.v + rect.d / 2) / 100 - plan.size.v / 200;
  return { x, z, width, depth };
}
