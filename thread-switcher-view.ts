export const SWITCHER_ROW_HEIGHT = 56;
export const SWITCHER_VIEWPORT_HEIGHT = SWITCHER_ROW_HEIGHT * 8;

/** Keep only the visible rows and two rows of overscan on either side mounted. */
export function threadWindow(total: number, scrollTop: number, height: number) {
  const start = Math.max(0, Math.floor(scrollTop / SWITCHER_ROW_HEIGHT) - 2);
  const end = Math.min(total, Math.ceil((scrollTop + height) / SWITCHER_ROW_HEIGHT) + 2);
  return { start, end, before: start * SWITCHER_ROW_HEIGHT, after: (total - end) * SWITCHER_ROW_HEIGHT };
}

export function revealThread(selected: number, scrollTop: number, height: number) {
  const top = selected * SWITCHER_ROW_HEIGHT;
  if (top < scrollTop) return top;
  if (top + SWITCHER_ROW_HEIGHT > scrollTop + height) return Math.max(0, top + SWITCHER_ROW_HEIGHT - height);
  return scrollTop;
}

/** The primary thread editor has a dedicated id; ThreadChat editors do not. */
export function focusPrimaryThreadComposer(doc: Document) {
  const editor = doc.getElementById("thread-detail-follow-up-composer");
  if (!editor || editor.getAttribute("contenteditable") !== "true") return false;
  editor.focus({ preventScroll: true });
  return doc.activeElement === editor;
}
