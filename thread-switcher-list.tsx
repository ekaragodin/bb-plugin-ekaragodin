import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import type { SwitcherState } from "./thread-switcher";
import { revealThread, threadWindow, SWITCHER_VIEWPORT_HEIGHT } from "./thread-switcher-view";

export function WindowedThreadList({ state, listRef, renderRow }: {
  state: SwitcherState;
  listRef: RefObject<HTMLDivElement | null>;
  renderRow(id: string, index: number): ReactNode;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(SWITCHER_VIEWPORT_HEIGHT);
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    const reveal = () => {
      setHeight(element.clientHeight);
      element.scrollTop = revealThread(state.selected, element.scrollTop, element.clientHeight);
      setScrollTop(element.scrollTop);
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(element);
    return () => observer.disconnect();
  }, [listRef, state.selected]);
  const window = threadWindow(state.ids.length, scrollTop, height);
  const selectedIsMounted = state.selected >= window.start && state.selected < window.end;
  return <div className="ek-thread-switcher-list" role="listbox" tabIndex={-1} ref={listRef}
    onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
    aria-labelledby="ek-thread-switcher-heading"
    aria-activedescendant={selectedIsMounted ? `ek-switcher-option-${state.selected}` : undefined}>
    <div aria-hidden="true" style={{ height: window.before }} />
    {state.ids.slice(window.start, window.end).map((id, offset) => renderRow(id, window.start + offset))}
    <div aria-hidden="true" style={{ height: window.after }} />
  </div>;
}
