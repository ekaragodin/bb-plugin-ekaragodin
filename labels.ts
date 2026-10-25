const ROW_CONTAINER = "[data-sidebar-rename-row]";
const ROW = "a[data-sidebar-thread-id]";
const BADGE = "data-thread-project-label";
const TITLE_ATTR = "data-thread-project-labels-title";
const STACK_ATTR = "data-thread-project-labels-stack";
const ROW_ATTR = "data-thread-project-labels-row";

/** Enhance existing rows without taking over BB's list, links, or menus. */
export function decorateThreadRows(doc: Document, labels: ReadonlyMap<string, string>) {
  const view = doc.defaultView;
  if (!view) return () => {};
  const ElementType = view.Element;
  const decorations = new Map<Element, {
    title: Element;
    stack: Element;
    badge: HTMLElement;
  }>();
  const style = doc.createElement("style");
  style.textContent = `
    [${BADGE}] {
      display: block; grid-column: -2 / -1; grid-row: 2; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 10px; line-height: 14px; opacity: .6;
      pointer-events: none;
    }
    [${TITLE_ATTR}] { grid-column: -2 / -1; grid-row: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [${STACK_ATTR}] { display: grid; grid-template-columns: minmax(0, 1fr); align-content: center; column-gap: 6px; }
    [${STACK_ATTR}]:has([data-sidebar-thread-provider]) { grid-template-columns: 16px minmax(0, 1fr); }
    [${STACK_ATTR}] > [data-sidebar-thread-provider] { grid-column: 1; grid-row: 1; margin-right: 0; }
    [${ROW_ATTR}] { height: auto !important; min-height: 44px !important; padding-block: 4px; }
  `;
  doc.head.append(style);
  let frame: number | null = null;
  const pending = new Set<Element>();
  const observer = new view.MutationObserver((records) => {
    for (const record of records) {
      collectRows(record.target, false);
      for (const node of [...record.addedNodes, ...record.removedNodes]) collectRows(node);
    }
    if (pending.size && frame === null) frame = view.requestAnimationFrame(refresh);
  });
  const observe = () => observer.observe(doc.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ["data-sidebar-thread-id"],
  });
  function collectRows(node: Node, includeDescendants = true) {
    if (!(node instanceof ElementType)) return;
    const row = node.closest(ROW_CONTAINER);
    if (row) pending.add(row);
    if (includeDescendants) {
      for (const child of node.querySelectorAll(ROW_CONTAINER)) pending.add(child);
    }
  }
  function removeDecoration(row: Element) {
    const decoration = decorations.get(row);
    if (!decoration) return;
    decoration.badge.remove();
    decoration.title.removeAttribute(TITLE_ATTR);
    decoration.stack.removeAttribute(STACK_ATTR);
    row.removeAttribute(ROW_ATTR);
    decorations.delete(row);
  }
  function updateRow(row: Element) {
    const anchor = row.querySelector<HTMLElement>(ROW);
    if (anchor?.closest(ROW_CONTAINER) !== row) {
      removeDecoration(row);
      return;
    }
    const name = labels.get(anchor?.dataset.sidebarThreadId ?? "");
    const title = row.querySelector(".bb-thread-title");
    const stack = title?.parentElement;
    if (!doc.body.contains(row) || !name || !title || !stack) {
      removeDecoration(row);
      return;
    }
    let decoration = decorations.get(row);
    if (decoration && (decoration.title !== title || decoration.stack !== stack)) {
      removeDecoration(row);
      decoration = undefined;
    }
    if (!decoration) {
      const badge = doc.createElement("span");
      badge.setAttribute(BADGE, "");
      decoration = { title, stack, badge };
      decorations.set(row, decoration);
    }
    const { badge } = decoration;
    if (badge.textContent !== name) badge.textContent = name;
    badge.title = `Project: ${name}`;
    if (title.nextSibling !== badge) title.after(badge);
    title.setAttribute(TITLE_ATTR, "");
    stack.setAttribute(STACK_ATTR, "");
    row.setAttribute(ROW_ATTR, "");
  }
  function refresh() {
    frame = null;
    observer.disconnect();
    for (const row of pending) updateRow(row);
    pending.clear();
    observe();
  }
  collectRows(doc.body);
  refresh();
  return () => {
    observer.disconnect();
    if (frame !== null) view.cancelAnimationFrame(frame);
    pending.clear();
    for (const row of decorations.keys()) removeDecoration(row);
    style.remove();
  };
}
