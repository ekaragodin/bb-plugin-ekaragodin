import { expect, it, vi } from "vitest";
import { readTitleContext, type TitleContextSdk, type TitleTimelineRow } from "./title-context";

function conversation(seq: number, text = `message ${seq}`, role: "user" | "assistant" = seq % 2 ? "user" : "assistant"): TitleTimelineRow {
  return { kind: "conversation", id: `opaque-message-${seq}`, messageSeq: seq * 10, sourceSeqStart: seq * 10 - 1,
    sourceSeqEnd: seq * 10 + 1, role, text };
}
function page(rows: TitleTimelineRow[], snapshot = "snapshot", older: string | null = null) {
  return { rows, timelinePage: { historySnapshot: snapshot,
    olderCursor: older ? { anchorId: older, anchorSeq: 20 } : null } };
}
function fixture(rows: TitleTimelineRow[], title: string | null = "Current title") {
  const messages = new Map(rows.filter(row => row.kind === "conversation").map(row => [row.messageSeq, row]));
  const get = vi.fn(async () => ({ title }));
  const timeline = vi.fn(async (_input: Parameters<TitleContextSdk["threads"]["timeline"]>[0]) => page(rows));
  const message = vi.fn(async ({ seq }: { seq: number }) => {
    const row = messages.get(seq);
    if (!row || row.kind !== "conversation" || !row.role || row.messageSeq === undefined || row.text === undefined) throw new Error("message not found");
    return { message: { id: row.id, messageSeq: row.messageSeq, role: row.role, text: row.text,
      sourceSeqStart: row.sourceSeqStart, sourceSeqEnd: row.sourceSeqEnd } };
  });
  const sdk: TitleContextSdk = { threads: { get, timeline, message } };
  return { sdk, get, timeline, message, messages };
}
function data(prompt: string): { currentTitle: string | null; messages: { role: string; text: string }[]; omittedMessages: number } {
  return JSON.parse(prompt.split("\nTHREAD_DATA_JSON\n")[1]);
}

it("reads first and latest full conversation messages across pages and nested turns using messageSeq", async () => {
  const rows = Array.from({ length: 14 }, (_, i) => conversation(i + 1));
  const f = fixture(rows);
  f.timeline.mockImplementation(async input => {
    return input.beforeAnchorId ? page(rows.slice(0, 7)) : page([
      { kind: "turn", id: "turn", sourceSeqStart: 70, sourceSeqEnd: 150, children: rows.slice(7) },
      { kind: "work", id: "tool", sourceSeqStart: 150, sourceSeqEnd: 151, text: "SECRET TOOL OUTPUT" },
    ], "snapshot", "older-page");
  });
  const result = await readTitleContext(f.sdk, "thread");
  expect(data(result.prompt)).toEqual({ currentTitle: "Current title", omittedMessages: 5,
    messages: [1, 2, 3, 9, 10, 11, 12, 13, 14].map(seq => ({ role: seq % 2 ? "user" : "assistant", text: `message ${seq}` })) });
  expect(f.message.mock.calls.map(([input]) => input.seq)).toEqual([10, 20, 30, 90, 100, 110, 120, 130, 140]);
  expect(result.prompt).not.toContain("SECRET TOOL OUTPUT");
  expect(f.timeline.mock.calls[0][0]).toMatchObject({ deferContent: "true", includeNestedRows: "true" });
});

it("deduplicates short overlapping history and omits empty and system-delivery messages", async () => {
  const one = conversation(1);
  const f = fixture([one, conversation(2, "  "), one, conversation(3, "user task"),
    { ...conversation(4, "tool result notification", "user"), initiator: "system" }]);
  const result = await readTitleContext(f.sdk, "thread");
  expect(data(result.prompt).messages.map(message => message.text)).toEqual(["message 1", "user task"]);
  expect(f.message).toHaveBeenCalledTimes(2);
});

it("hydrates only selected messages instead of using a timeline preview as full content", async () => {
  const f = fixture([conversation(1, "preview")]);
  f.messages.set(10, conversation(1, "The actual full task body"));
  expect(data((await readTitleContext(f.sdk, "thread")).prompt).messages[0].text).toBe("The actual full task body");
});

it("bounds Unicode message text and escaped JSON while preserving message beginnings and endings", async () => {
  const text = "BEGIN" + '😀\\"'.repeat(2_000) + "END";
  const f = fixture(Array.from({ length: 12 }, (_, i) => conversation(i + 1, text)));
  const result = await readTitleContext(f.sdk, "thread");
  expect(result.prompt.length).toBeLessThanOrEqual(24_000);
  for (const message of data(result.prompt).messages) {
    expect([...message.text].length).toBeLessThanOrEqual(2_000);
    expect(message.text.startsWith("BEGIN")).toBe(true);
    expect(message.text.endsWith("END")).toBe(true);
    expect(message.text).toContain("[truncated]");
    expect(message.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  }
});

it("tells the model to prioritize the current goal, prefix only its known ticket and retain a fitting title", async () => {
  const f = fixture([conversation(1, "Old ticket #12"), conversation(2, "Now implement ticket #123")], "#123 Implement switching");
  const { prompt } = await readTitleContext(f.sdk, "thread");
  expect(prompt).toContain("latest messages");
  expect(prompt).toContain("ticket number at the beginning");
  expect(prompt).toContain("Never invent");
  expect(prompt).toContain("return the current title unchanged");
  expect(prompt).toContain("untrusted data");
  expect(data(prompt).messages[1].text).toBe("Now implement ticket #123");
});

it("restarts an inconsistent paginated snapshot before hydrating its selected messages", async () => {
  const f = fixture([conversation(1), conversation(2)]);
  f.timeline.mockResolvedValueOnce(page([conversation(2)], "old", "page"))
    .mockResolvedValueOnce(page([conversation(1)], "new"))
    .mockResolvedValueOnce(page([conversation(1), conversation(2)], "new"))
    .mockResolvedValueOnce(page([conversation(1), conversation(2)], "new"));
  expect(data((await readTitleContext(f.sdk, "thread")).prompt).messages).toHaveLength(2);
  expect(f.message).toHaveBeenCalledTimes(2);
});

it("retries a snapshot changed during hydration and fails clearly if changes never settle", async () => {
  const f = fixture([conversation(1)]);
  let n = 0;
  f.timeline.mockImplementation(async () => page([conversation(1)], `revision-${++n}`));
  await expect(readTitleContext(f.sdk, "thread")).rejects.toThrow("conversation changed");
  expect(f.timeline.mock.calls.length).toBeLessThanOrEqual(6);
});

it("keeps fingerprint stable across unrelated timeline revisions but changes it for selected text or title", async () => {
  const f = fixture([conversation(1)]);
  const first = await readTitleContext(f.sdk, "thread");
  f.timeline.mockResolvedValue(page([conversation(1)], "unrelated-revision"));
  expect((await readTitleContext(f.sdk, "thread")).fingerprint).toBe(first.fingerprint);
  f.messages.set(10, conversation(1, "A new task"));
  const changed = await readTitleContext(f.sdk, "thread");
  expect(changed.fingerprint).not.toBe(first.fingerprint);
  f.get.mockResolvedValue({ title: "Renamed" });
  expect((await readTitleContext(f.sdk, "thread")).fingerprint).not.toBe(changed.fingerprint);
});

it("does not generate from an empty conversation or follow a repeated cursor forever", async () => {
  await expect(readTitleContext(fixture([]).sdk, "thread")).rejects.toThrow("no conversation messages");
  const f = fixture([conversation(1)]);
  f.timeline.mockResolvedValue(page([conversation(1)], "snapshot", "same-cursor"));
  await expect(readTitleContext(f.sdk, "thread")).rejects.toThrow("pagination");
});

it("honors cancellation before reading any context", async () => {
  const f = fixture([conversation(1)]);
  const controller = new AbortController();
  controller.abort();
  await expect(readTitleContext(f.sdk, "thread", controller.signal)).rejects.toThrow();
  expect(f.get).not.toHaveBeenCalled();
});
