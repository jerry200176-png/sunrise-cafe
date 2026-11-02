/** Copy without treating a rejected or unsuccessful fallback as success. */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Try the synchronous fallback when clipboard permission is unavailable.
    }
  }
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    if (textarea) {
      const restore = document.activeElement === textarea;
      textarea.remove();
      if (restore && previous?.isConnected) {
        try { previous.focus(); } catch { /* Focus restoration is best effort. */ }
      }
    }
  }
}
