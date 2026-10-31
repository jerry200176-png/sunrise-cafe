/** Browser-local safety holds; not a cross-tab atomic lock or server idempotency. */
export function qrHoldKey(tableToken: string): string {
  return `qr-order.pending:${encodeURIComponent(tableToken)}`;
}

export function qrHoldEntries(tableToken: string): Array<{ key: string; value: string }> {
  const base = qrHoldKey(tableToken);
  const found: Array<{ key: string; value: string }> = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key || (key !== base && !key.startsWith(`${base}:review:`))) continue;
    const value = localStorage.getItem(key);
    if (value !== null) found.push({ key, value });
  }
  return found;
}

export function qrIsHoldKey(tableToken: string, key: string | null): boolean {
  const base = qrHoldKey(tableToken);
  return key === null || key === base || key.startsWith(`${base}:review:`);
}
