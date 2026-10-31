// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createThreadSwitcher, isSwitcherComposerFocused, sidebarThreadOrder, type SwitcherState } from "./thread-switcher";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each([0, 99, 100])("switches without showing the list when Ctrl is released after %i ms", elapsed => {
  const h = setup();
  h.tab();
  expect(h.state?.visible).toBe(false);
  vi.advanceTimersByTime(elapsed);
  expect(h.state?.visible).toBe(false);
  h.release();
  expect(h.commit).toHaveBeenCalledExactlyOnceWith("b");
  vi.advanceTimersByTime(200);
  expect(h.state).toBeNull();
});

it("starts the delay at Ctrl+Tab and reveals automatically only after 100 ms", () => {
  const h = setup();
  h.switcher.keydown(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
  vi.advanceTimersByTime(500);
  expect(h.state).toBeNull();
  h.tab();
  vi.advanceTimersByTime(100);
  expect(h.state?.visible).toBe(false);
  vi.advanceTimersByTime(1);
  expect(h.state?.visible).toBe(true);
  expect(h.commit).not.toHaveBeenCalled();
  h.release();
  expect(h.commit).toHaveBeenCalledExactlyOnceWith("b");
});

it("keeps all fast forward and reverse steps without restarting the reveal delay", () => {
  const h = setup();
  h.tab();
  vi.advanceTimersByTime(40);
  h.tab();
  h.tab();
  h.tab(true);
  expect(h.state?.selected).toBe(2);
  expect(h.state?.visible).toBe(false);
  vi.advanceTimersByTime(61);
  expect(h.state?.visible).toBe(true);
  expect(h.state?.selected).toBe(2);
  h.tab(true);
  expect(h.state?.visible).toBe(true);
  h.release();
  expect(h.commit).toHaveBeenCalledExactlyOnceWith("b");
});

it("commits the final selection after several invisible steps", () => {
  const h = setup();
  h.tab(); h.tab(); h.tab(); h.tab(true);
  expect(h.state?.visible).toBe(false);
  h.release();
  expect(h.commit).toHaveBeenCalledExactlyOnceWith("a");
});

it.each(["escape", "blur", "navigation", "archive"])("cancels the pending reveal on %s", reason => {
  const h = setup();
  h.tab();
  vi.advanceTimersByTime(50);
  if (reason === "escape") h.switcher.keydown(new KeyboardEvent("keydown", { key: "Escape" }));
  if (reason === "blur") h.switcher.cancel(false);
  if (reason === "navigation") h.switcher.update("a", ["a", "b", "c"]);
  if (reason === "archive") h.switcher.update("c", ["a", "c"]);
  vi.advanceTimersByTime(200);
  expect(h.state).toBeNull();
  h.release();
  expect(h.commit).not.toHaveBeenCalled();
});

it("gives each new gesture its own full delay", () => {
  const h = setup();
  h.tab();
  vi.advanceTimersByTime(50);
  h.release();
  h.tab();
  vi.advanceTimersByTime(51);
  expect(h.state?.visible).toBe(false);
  vi.advanceTimersByTime(50);
  expect(h.state?.visible).toBe(true);
});

function setup() {
  let state: SwitcherState | null = null;
  const commit = vi.fn();
  const cancel = vi.fn();
  const focused = vi.fn(() => true);
  const switcher = createThreadSwitcher({
    isComposerFocused: focused, commit, cancel,
    changed: next => { state = next; },
  });
  const available = ["a", "b", "c"];
  for (const id of available) switcher.update(id, available);
  const tab = (shiftKey = false) => {
    const event = new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, shiftKey, cancelable: true });
    switcher.keydown(event);
    return event;
  };
  const release = () => switcher.keyup(new KeyboardEvent("keyup", { key: "Control" }));
  return { switcher, commit, cancel, focused, tab, release, get state() { return state; } };
}

it("selects the last visited thread, freezes the order and commits only on Ctrl release", () => {
  const h = setup();
  expect(h.tab().defaultPrevented).toBe(true);
  expect(h.state).toEqual({ ids: ["c", "b", "a"], selected: 1, visible: false });
  // A realtime update changes neither the history nor the open selection.
  h.switcher.update("c", ["b", "a", "c"]);
  expect(h.commit).not.toHaveBeenCalled();
  h.tab();
  expect(h.state?.selected).toBe(2);
  h.tab();
  expect(h.state?.selected).toBe(0);
  h.tab(true);
  expect(h.state?.selected).toBe(2);
  h.release();
  expect(h.commit).toHaveBeenCalledExactlyOnceWith("a");
  expect(h.state).toBeNull();
});

it("toggles between the last two visits after confirmation", () => {
  const h = setup();
  h.tab(); h.release();
  h.switcher.update("b", ["a", "b", "c"]);
  h.tab();
  expect(h.state).toEqual({ ids: ["b", "c", "a"], selected: 1, visible: false });
  h.release();
  expect(h.commit.mock.calls).toEqual([["b"], ["c"]]);
});

it("reverses from the first press and ignores unrelated modifier keys", () => {
  const h = setup();
  for (const modifiers of [{ ctrlKey: false }, { ctrlKey: true, metaKey: true }, { ctrlKey: true, altKey: true }, { ctrlKey: true, isComposing: true }]) {
    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true, ...modifiers });
    h.switcher.keydown(event);
    expect(event.defaultPrevented).toBe(false);
  }
  h.tab(true);
  expect(h.state?.selected).toBe(2);
});

it("does not intercept outside the composer, but continues once the list has focus", () => {
  const h = setup();
  h.focused.mockReturnValue(false);
  expect(h.tab().defaultPrevented).toBe(false);
  expect(h.state).toBeNull();
  h.focused.mockReturnValue(true);
  h.tab();
  h.focused.mockReturnValue(false);
  expect(h.tab().defaultPrevented).toBe(true);
  expect(h.state?.selected).toBe(2);
});

it("Escape, blur and external navigation cancel without changing history", () => {
  const h = setup();
  h.tab();
  const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  h.switcher.keydown(escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(h.cancel).toHaveBeenLastCalledWith(true);
  h.release();
  expect(h.commit).not.toHaveBeenCalled();
  h.tab();
  expect(h.state?.selected).toBe(1);
  h.switcher.cancel(false);
  expect(h.cancel).toHaveBeenLastCalledWith(false);
  h.release();
  h.tab();
  h.switcher.update("a", ["a", "b", "c"]);
  expect(h.state).toBeNull();
  h.release();
  expect(h.commit).not.toHaveBeenCalled();
});

it("excludes unavailable threads and cancels if one is archived during selection", () => {
  const h = setup();
  h.switcher.update("c", ["a", "c"]);
  h.tab();
  expect(h.state).toEqual({ ids: ["c", "a"], selected: 1, visible: false });
  h.switcher.update("c", ["c"]);
  expect(h.state).toBeNull();
  h.release();
  expect(h.commit).not.toHaveBeenCalled();
  expect(h.tab().defaultPrevented).toBe(true);
  expect(h.state).toBeNull();
});

it("starts with all available threads in sidebar order, even before visiting them", () => {
  let state: SwitcherState | null = null;
  const switcher = createThreadSwitcher({
    isComposerFocused: () => true,
    sidebarOrder: () => ["c", "a", "b"],
    changed: next => { state = next; }, commit: vi.fn(), cancel: vi.fn(),
  });
  switcher.update("a", ["a", "b", "c"]);
  switcher.keydown(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true }));
  expect(state).toEqual({ ids: ["c", "a", "b"], selected: 2, visible: false });
});

it("keeps visited threads first and appends unvisited threads in current sidebar order", () => {
  let state: SwitcherState | null = null;
  let order = ["d", "c", "b", "a"];
  const switcher = createThreadSwitcher({
    isComposerFocused: () => true, sidebarOrder: () => order,
    changed: next => { state = next; }, commit: vi.fn(), cancel: vi.fn(),
  });
  switcher.update("a", order);
  switcher.update("b", order);
  const tab = () => switcher.keydown(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true }));
  tab();
  expect(state).toEqual({ ids: ["b", "a", "d", "c"], selected: 1, visible: false });
  order = ["c", "d", "b", "a"];
  switcher.update("b", order);
  tab();
  expect(state).toEqual({ ids: ["b", "a", "d", "c"], selected: 2, visible: false });
  switcher.cancel(false);
  tab();
  expect(state).toEqual({ ids: ["b", "a", "c", "d"], selected: 1, visible: false });
});

it("reads sidebar row order without duplicates and includes unrendered threads", () => {
  document.body.innerHTML = '<a data-sidebar-thread-id="c"></a><a data-sidebar-thread-id="a"></a><a data-sidebar-thread-id="c"></a><a data-sidebar-thread-id="archived"></a>';
  expect(sidebarThreadOrder(document, ["a", "b", "c", "d"])).toEqual(["c", "a", "b", "d"]);
  document.body.replaceChildren();
});

it("recognizes the main thread editor and excludes queued editors and other fields", () => {
  const editor = document.createElement("div");
  editor.id = "thread-detail-follow-up-composer";
  editor.tabIndex = 0;
  const queued = document.createElement("textarea");
  document.body.append(editor, queued);
  editor.focus();
  expect(isSwitcherComposerFocused(document)).toBe(true);
  queued.focus();
  expect(isSwitcherComposerFocused(document)).toBe(false);
  document.body.replaceChildren();
});

it("opens from the new-thread composer using MRU and supports reverse selection", () => {
  const h = setup();
  h.switcher.update(null, ["a", "b", "c"]);
  h.tab();
  expect(h.state).toEqual({ ids: ["c", "b", "a"], selected: 0, visible: false });
  h.release();
  expect(h.commit).toHaveBeenCalledExactlyOnceWith("c");
  h.tab(true);
  expect(h.state?.selected).toBe(2);
});

it("opens from new-thread compose before any visits, including a single available thread", () => {
  const h = setup();
  // A fresh window starts with no current thread or visited history.
  let state: SwitcherState | null = null;
  const switcher = createThreadSwitcher({ isComposerFocused: () => true, changed: next => { state = next; }, commit: h.commit, cancel: h.cancel });
  switcher.update(null, ["a", "b"]);
  switcher.keydown(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true }));
  expect(state).toEqual({ ids: ["a", "b"], selected: 0, visible: false });
  switcher.cancel(true);
  switcher.update(null, ["b"]);
  switcher.keydown(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true }));
  expect(state).toEqual({ ids: ["b"], selected: 0, visible: false });
  switcher.keyup(new KeyboardEvent("keyup", { key: "Control" }));
  expect(h.commit).toHaveBeenCalledExactlyOnceWith("b");
  switcher.update(null, []);
  switcher.keydown(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true }));
  expect(state).toBeNull();
});

it("recognizes the new-thread editor and requests focus restoration on cancellation", () => {
  const editor = document.createElement("div");
  editor.id = "root-compose-prompt";
  editor.tabIndex = 0;
  document.body.append(editor);
  editor.focus();
  expect(isSwitcherComposerFocused(document)).toBe(true);
  const h = setup();
  h.switcher.update(null, ["a", "b", "c"]);
  h.tab();
  h.switcher.keydown(new KeyboardEvent("keydown", { key: "Escape" }));
  h.release();
  expect(h.cancel).toHaveBeenCalledExactlyOnceWith(true);
  expect(h.commit).not.toHaveBeenCalled();
  document.body.replaceChildren();
});
