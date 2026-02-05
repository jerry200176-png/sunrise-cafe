export function getDurationOptions() {
  // 產生 1, 1.5, 2, 2.5 ... 10
  const options = [];
  for (let i = 1; i <= 10; i += 0.5) {
    options.push(i);
  }
  return options;
}