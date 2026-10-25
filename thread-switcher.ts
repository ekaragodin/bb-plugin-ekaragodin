export interface SwitcherState {
  ids: readonly string[];
  selected: number;
}

interface SwitcherOptions {
  isComposerFocused(): boolean;
  sidebarOrder?(): readonly string[];
  changed(state: SwitcherState | null): void;
  commit(id: string): void;
  cancel(restoreFocus: boolean): void;
}

/** Per-window visit history. Background thread updates never count as visits. */
export function createThreadSwitcher(options: SwitcherOptions) {
  let history: string[] = [];
  let current: string | null = null;
  let eligible = new Set<string>();
  let state: SwitcherState | null = null;

  function publish(next: SwitcherState | null) {
    state = next;
    options.changed(next);
  }
  function cancel(restoreFocus: boolean) {
    if (!state) return;
    publish(null);
    options.cancel(restoreFocus);
  }
  function consume(event: KeyboardEvent) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  return {
    update(threadId: string | null, availableIds: readonly string[]) {
      eligible = new Set(availableIds);
      if (threadId !== current) {
        cancel(false);
        // The initial list follows the sidebar. Only subsequent navigation
        // establishes MRU priority, including the thread we just left.
        if (current || history.length) {
          const visits = [threadId, current].filter((id): id is string => id !== null);
          history = [...new Set([...visits, ...history])];
        }
        current = threadId;
      }
      // Prune removed/archived threads without changing the order of visits.
      history = history.filter(id => eligible.has(id) || id === current);
      if (state && state.ids.some(id => !eligible.has(id))) cancel(true);
    },
    keydown(event: KeyboardEvent) {
      if (state && event.key === "Escape") {
        consume(event);
        cancel(true);
        return;
      }
      if (event.key !== "Tab" || !event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      if (!state) {
        if (!options.isComposerFocused()) return;
        consume(event);
        const ids = [...new Set([...history, ...(options.sidebarOrder?.() ?? []), ...eligible])].filter(id => eligible.has(id));
        if (!ids.length || (current && (ids.length < 2 || !ids.includes(current)))) return;
        const index = current ? ids.indexOf(current) : event.shiftKey ? 0 : -1;
        publish({ ids, selected: (index + (event.shiftKey ? -1 : 1) + ids.length) % ids.length });
      } else {
        consume(event);
        publish({ ids: state.ids, selected: (state.selected + (event.shiftKey ? -1 : 1) + state.ids.length) % state.ids.length });
      }
    },
    keyup(event: KeyboardEvent) {
      if (!state || event.key !== "Control") return;
      consume(event);
      const id = state.ids[state.selected];
      publish(null);
      if (eligible.has(id)) options.commit(id);
    },
    cancel,
  };
}

/** BB's main thread and new-thread editors; other inputs and queued editors opt out. */
export function isSwitcherComposerFocused(doc: Document) {
  const id = doc.activeElement?.id;
  return id === "thread-detail-follow-up-composer" || id === "root-compose-prompt";
}

/** Read the rendered sidebar order, then include threads from collapsed/offscreen groups. */
export function sidebarThreadOrder(doc: Document, availableIds: readonly string[]) {
  const eligible = new Set(availableIds);
  const rendered = Array.from(doc.querySelectorAll("a[data-sidebar-thread-id]"), row =>
    row.getAttribute("data-sidebar-thread-id") ?? "",
  );
  return [...new Set([...rendered, ...availableIds])].filter(id => eligible.has(id));
}
