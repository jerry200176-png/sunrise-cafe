/** Resolve effective closed dates: per-branch overrides global settings. */
export function resolveClosedDates(
  branchClosed: string[] | null | undefined,
  globalClosed: string[] | null | undefined
): string[] {
  if (Array.isArray(branchClosed) && branchClosed.length > 0) {
    return branchClosed;
  }
  return globalClosed ?? [];
}

export function isDateClosed(date: string, closedDates: string[]): boolean {
  return closedDates.includes(date);
}
