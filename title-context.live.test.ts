import { expect, it } from "vitest";
import { readTitleContext, type TitleContextSdk } from "./title-context";

it.skipIf(!process.env.TITLE_SMOKE_THREAD_ID)("reads a real BB conversation without treating row IDs as sequences", async () => {
  const origin = new URL(process.env.BB_SERVER_URL!).origin;
  const threadId = process.env.TITLE_SMOKE_THREAD_ID!;
  async function read(path: string, query: Record<string, string> = {}, signal?: AbortSignal) {
    const response = await fetch(`${origin}/api/v1/threads/${encodeURIComponent(threadId)}${path}?${new URLSearchParams(query)}`, { signal });
    if (!response.ok) throw new Error(`BB returned HTTP ${response.status}`);
    return response.json();
  }
  const sdk: TitleContextSdk = { threads: {
    get: ({ signal }) => read("", {}, signal),
    timeline: ({ signal, threadId: _threadId, ...query }) => read("/timeline", query, signal),
    message: ({ seq, signal }) => read(`/messages/${seq}`, { before: "0", after: "0" }, signal),
  } };
  const snapshot = await readTitleContext(sdk, threadId);
  expect(snapshot.prompt.length).toBeLessThanOrEqual(24_000);
  expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
  const data = JSON.parse(snapshot.prompt.split("THREAD_DATA_JSON\n")[1]);
  expect(data.messages.length).toBeGreaterThan(0);
  expect(data.messages.length).toBeLessThanOrEqual(9);
  expect(data.messages.every((message: { role: string }) => ["user", "assistant"].includes(message.role))).toBe(true);
}, 30_000);
