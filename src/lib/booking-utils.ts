/**
 * 時數選項：從 1.0 小時起，每 0.5 小時一檔（1, 1.5, 2, 2.5, ... 8）
 */
export function getDurationOptions(): number[] {
  const options: number[] = [];
  for (let h = 1; h <= 8; h += 0.5) {
    options.push(h);
  }
  return options;
}
