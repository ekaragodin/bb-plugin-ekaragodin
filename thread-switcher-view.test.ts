// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { focusPrimaryThreadComposer, revealThread, threadWindow, SWITCHER_ROW_HEIGHT as row, SWITCHER_VIEWPORT_HEIGHT as height } from "./thread-switcher-view";

afterEach(() => document.body.replaceChildren());

it("bounds mounted rows for a large catalog and preserves spacer height", () => {
  for (const selected of [0, 1, 8, 5000, 9999, 0]) {
    const top = revealThread(selected, 0, height);
    const range = threadWindow(10000, top, height);
    expect(range.end - range.start).toBeLessThanOrEqual(12);
    expect(range.start).toBeLessThanOrEqual(selected);
    expect(range.end).toBeGreaterThan(selected);
    expect(range.before + (range.end - range.start) * row + range.after).toBe(10000 * row);
  }
});

it("reveals the selection in both directions and wraps without moving visible rows", () => {
  expect(revealThread(7, 0, height)).toBe(0);
  expect(revealThread(8, 0, height)).toBe(row);
  expect(revealThread(0, 500 * row, height)).toBe(0);
  expect(revealThread(9999, 0, height)).toBe(9992 * row);
  expect(revealThread(10, 10 * row, 2 * row)).toBe(10 * row);
  expect(revealThread(12, 10 * row, 2 * row)).toBe(11 * row);
});

it("windows manual scroll and handles a short catalog", () => {
  expect(threadWindow(3, 0, height)).toEqual({ start: 0, end: 3, before: 0, after: 0 });
  const range = threadWindow(10000, 500 * row, height);
  expect(range.start).toBe(498);
  expect(range.end).toBe(510);
});

it("focuses the primary editor even when a panel for the same thread mounted first", () => {
  document.body.innerHTML = '<div data-thread-id="same"><div id="panel-composer" contenteditable="true" tabindex="0"></div></div><div data-thread-id="same"><div id="thread-detail-follow-up-composer" contenteditable="true" tabindex="0"></div></div>';
  document.getElementById("panel-composer")!.focus();
  expect(focusPrimaryThreadComposer(document)).toBe(true);
  expect(document.activeElement?.id).toBe("thread-detail-follow-up-composer");
});

it("waits for the primary editor instead of focusing a matching panel or loading shell", () => {
  document.body.innerHTML = '<div data-thread-id="same"><div id="panel-composer" contenteditable="true" tabindex="0"></div></div>';
  const panel = document.getElementById("panel-composer")!;
  panel.focus();
  expect(focusPrimaryThreadComposer(document)).toBe(false);
  expect(document.activeElement).toBe(panel);
  const editor = document.createElement("div");
  editor.id = "thread-detail-follow-up-composer";
  document.body.append(editor);
  expect(focusPrimaryThreadComposer(document)).toBe(false);
  editor.contentEditable = "true";
  editor.setAttribute("contenteditable", "true");
  editor.tabIndex = 0;
  expect(focusPrimaryThreadComposer(document)).toBe(true);
  expect(document.activeElement).toBe(editor);
});
