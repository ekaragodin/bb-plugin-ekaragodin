// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { decorateThreadRows } from "./labels";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

// The built-in list overlays an anchor on a sibling title, not inside it.
function addRow(id: string) {
  const row = document.createElement("div");
  row.setAttribute("data-sidebar-rename-row", "");
  row.innerHTML = `<span><a data-sidebar-thread-id="${id}" href="/thread/${id}"></a><span><span class="bb-thread-title">Thread title</span></span></span><button>Archive</button>`;
  document.body.append(row);
  return row;
}
async function flush() {
  await Promise.resolve();
  vi.advanceTimersByTime(20);
}

it("labels known projects without changing links, titles or row actions", () => {
  const row = addRow("one");
  addRow("unknown");
  dispose = decorateThreadRows(document, new Map([["one", "rotom-control"]]));
  expect(document.querySelectorAll("[data-thread-project-label]")).toHaveLength(1);
  expect(row.querySelector("[data-thread-project-label]")?.textContent).toBe("rotom-control");
  expect(row.querySelector(".bb-thread-title")?.textContent).toBe("Thread title");
  expect(row.querySelector("a")?.getAttribute("href")).toBe("/thread/one");
  expect(row.querySelector("button")?.textContent).toBe("Archive");
});

it("handles inserted rows, reused row ids and title replacement without duplicates", async () => {
  vi.useFakeTimers();
  dispose = decorateThreadRows(document, new Map([["one", "First"], ["two", "Second"]]));
  const row = addRow("one");
  await flush();
  expect(row.querySelector("[data-thread-project-label]")?.textContent).toBe("First");
  row.querySelector("a")!.dataset.sidebarThreadId = "two";
  row.querySelector(".bb-thread-title")!.textContent = "Renamed";
  await flush();
  expect(row.querySelectorAll("[data-thread-project-label]")).toHaveLength(1);
  expect(row.querySelector("[data-thread-project-label]")?.textContent).toBe("Second");
  row.querySelector("a")!.dataset.sidebarThreadId = "unknown";
  await flush();
  expect(row.querySelector("[data-thread-project-label]")).toBeNull();
});

it("cleans up nodes, styles and queued work on disable and remount", async () => {
  vi.useFakeTimers();
  const row = addRow("one");
  const initialHead = document.head.innerHTML;
  dispose = decorateThreadRows(document, new Map([["one", "Old name"]]));
  addRow("one");
  await Promise.resolve();
  dispose();
  vi.advanceTimersByTime(20);
  expect(document.querySelector("[data-thread-project-label]")).toBeNull();
  expect(document.querySelector("[data-thread-project-labels-title]")).toBeNull();
  expect(document.head.innerHTML).toBe(initialHead);
  dispose = decorateThreadRows(document, new Map([["one", "New name"]]));
  expect(row.querySelector("[data-thread-project-label]")?.textContent).toBe("New name");
  expect(document.querySelectorAll("[data-thread-project-label]")).toHaveLength(2);
});

it("renders project names as text, including markup characters", () => {
  const row = addRow("one");
  dispose = decorateThreadRows(document, new Map([["one", "<img src=x onerror=alert(1)>"]]));
  expect(row.querySelector("img")).toBeNull();
  expect(row.querySelector("[data-thread-project-label]")?.textContent).toBe("<img src=x onerror=alert(1)>");
});

it("preserves labels and leaves unrelated rows untouched after a local mutation", async () => {
  vi.useFakeTimers();
  const rows = Array.from({ length: 100 }, (_, i) => addRow(String(i)));
  dispose = decorateThreadRows(document, new Map(rows.map((_, i) => [String(i), `Project ${i}`])));
  const badges = rows.map((row) => row.querySelector("[data-thread-project-label]"));
  const unrelatedQuery = vi.spyOn(rows[99], "querySelector");
  rows[0].querySelector("button")!.textContent = "Updated action";
  await flush();
  expect(unrelatedQuery).not.toHaveBeenCalled();
  unrelatedQuery.mockRestore();
  rows.forEach((row, i) => {
    expect(row.querySelector("[data-thread-project-label]")).toBe(badges[i]);
  });
});

it("decorates new rows without revisiting existing ones and cleans up removed rows", async () => {
  vi.useFakeTimers();
  const existing = addRow("one");
  dispose = decorateThreadRows(document, new Map([["one", "Project"]]));
  const existingQuery = vi.spyOn(existing, "querySelector");
  const added = addRow("one");
  await flush();
  expect(existingQuery).not.toHaveBeenCalled();
  expect(added.querySelector("[data-thread-project-label]")?.textContent).toBe("Project");
  added.remove();
  await flush();
  expect(added.querySelector("[data-thread-project-label]")).toBeNull();
  expect(added.hasAttribute("data-thread-project-labels-row")).toBe(false);
  expect(existingQuery).not.toHaveBeenCalled();
  existingQuery.mockRestore();
});

it("moves the label to a replaced title and restores a removed badge", async () => {
  vi.useFakeTimers();
  const row = addRow("one");
  dispose = decorateThreadRows(document, new Map([["one", "Project"]]));
  const oldTitle = row.querySelector(".bb-thread-title")!;
  const newTitle = oldTitle.cloneNode(true);
  oldTitle.replaceWith(newTitle);
  await flush();
  expect(oldTitle.hasAttribute("data-thread-project-labels-title")).toBe(false);
  expect(row.querySelectorAll("[data-thread-project-label]")).toHaveLength(1);
  const badge = row.querySelector("[data-thread-project-label]")!;
  expect(newTitle.nextSibling).toBe(badge);
  badge.remove();
  await flush();
  expect(newTitle.nextSibling).toBe(badge);
});

it("does not decorate a section wrapper using a nested thread's title", async () => {
  vi.useFakeTimers();
  const section = document.createElement("div");
  section.setAttribute("data-sidebar-rename-row", "");
  const parent = addRow("parent");
  const child = addRow("child");
  section.append(parent, child);
  document.body.append(section);
  dispose = decorateThreadRows(document, new Map([["parent", "Project"], ["child", "Project"]]));
  expect(parent.querySelectorAll("[data-thread-project-label]")).toHaveLength(1);
  expect(child.querySelectorAll("[data-thread-project-label]")).toHaveLength(1);
  expect(section.hasAttribute("data-thread-project-labels-row")).toBe(false);
  parent.remove();
  await flush();
  expect(child.querySelectorAll("[data-thread-project-label]")).toHaveLength(1);
  expect(section.hasAttribute("data-thread-project-labels-row")).toBe(false);
});

it("keeps row spacing when BB replaces classes while switching threads", async () => {
  vi.useFakeTimers();
  const row = addRow("one");
  row.className = "sidebar-row";
  dispose = decorateThreadRows(document, new Map([["one", "Project"]]));
  expect(getComputedStyle(row).minHeight).toBe("44px");
  expect(getComputedStyle(row).paddingBlock).toBe("4px");

  // React owns className and replaces it when selection/hover state changes.
  row.className = "sidebar-row selected";
  const title = row.querySelector<HTMLElement>(".bb-thread-title")!;
  title.className = "bb-thread-title selected";
  title.parentElement!.className = "title-container selected";
  await flush();
  expect(getComputedStyle(row).minHeight).toBe("44px");
  expect(getComputedStyle(row).paddingBlock).toBe("4px");
  expect(getComputedStyle(title.parentElement!).display).toBe("grid");
  expect(getComputedStyle(title).gridRow).toBe("1");
  dispose();
  expect(row.hasAttribute("data-thread-project-labels-row")).toBe(false);
  expect(title.hasAttribute("data-thread-project-labels-title")).toBe(false);
  expect(title.parentElement!.hasAttribute("data-thread-project-labels-stack")).toBe(false);
});
