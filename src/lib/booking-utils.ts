// Force update: Enable 0.5 hour intervals
export function getDurationOptions() {
  const options = [];
  for (let i = 1; i <= 10; i += 0.5) {
    options.push(i);
  }
  return options;
}