/**
 * 付款審核的鍵盤快速鍵只在「焦點在頁面空白處」時生效。
 * 焦點在按鈕、連結、輸入框等可互動元件上時，Enter／空白鍵屬於該元件，
 * 否則在「駁回」上按 Enter 會變成核准（金錢操作）。
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "SUMMARY"].includes(target.tagName)) return true;
  return target.closest("[role='button'],[role='link'],[role='dialog']") !== null;
}
