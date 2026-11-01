import { afterEach, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
  vi.restoreAllMocks();
});

function fixture(pending = false) {
  let title = "Original title";
  let completionSignal: AbortSignal | undefined;
  const completionCalls: { hostId: string; input: unknown }[] = [];
  const updates: unknown[] = [];
  const thread = () => makeThreadResponse({ id: "target", providerId: "claude-code", title });
  const message = {
    kind: "conversation", id: "target:user:1", messageSeq: 1, role: "user",
    text: "Fix ticket #123 tab switching", sourceSeqStart: 1, sourceSeqEnd: 1,
  };
  const rows = [
    { id: "failed", seq: 10, createdAt: 1001, threadId: "target", type: "turn/completed", scope: { kind: "turn", turnId: "failed" }, data: { status: "failed", providerThreadId: "native" } },
    { id: "done", seq: 20, createdAt: 1002, threadId: "target", type: "turn/completed", scope: { kind: "turn", turnId: "done" }, data: { status: "completed", providerThreadId: "native" } },
  ];
  const host = createFakePluginHost({
    pluginId: "ekaragodin",
    sdk: {
      system: { config: async () => ({ primaryHostId: "primary" }) },
      providers: {
        list: async () => [{ id: "codex", displayName: "Codex", available: true }],
        models: async () => ({ models: [{ id: "gpt-small", model: "gpt-small" }], modelLoadError: null }),
      },
      hosts: { providerCliStatus: async () => ({ codex: { installed: true, executablePath: "/usr/bin/codex" } }) },
      threads: {
        get: async () => thread(),
        timeline: async () => ({ rows: [message], timelinePage: { historySnapshot: "stable", olderCursor: null } }),
        message: async () => ({ message }),
        events: { list: async (input: { afterSeq?: string }) => rows.filter(row => row.seq > Number(input.afterSeq ?? 0)) },
        update: async (input: { title?: string | null }) => { updates.push(input); title = input.title ?? title; return thread(); },
      },
    },
    experimental_callHostRpc: async ({ method, input, hostId, signal }) => {
      expect(method).toBe("titleComplete");
      completionCalls.push({ hostId, input });
      completionSignal = signal;
      if (!signal) throw new Error("The host completion must receive cancellation.");
      if (pending) return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
      return { title: "#123 Fix tab switching" };
    },
  });
  hosts.push(host);
  return { host, thread, completionCalls, updates, completionSignal: () => completionSignal };
}

it("runs production completion-event and manual RPC wiring on the selected primary host, without replay on reload", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const f = fixture();
  let host = f.host;
  await host.bb.storage.kv.set("title-settings", { titleProvider: "codex", titleModel: "gpt-small" });
  plugin(host.bb);
  await host.harness.behavior.emitThreadEvent("experimental_thread.events", { thread: f.thread(), sequence: 20 });
  expect(f.completionCalls).toHaveLength(1);
  expect(f.completionCalls[0]).toMatchObject({ hostId: "primary", input: { providerId: "codex", model: "gpt-small", executablePath: "/usr/bin/codex" } });
  expect(f.updates).toEqual([{ threadId: "target", title: "#123 Fix tab switching" }]);

  const manual = await host.harness.behavior.callRpc("refreshTitle", { threadId: "target" });
  expect(manual).toEqual({ status: "unchanged", title: "#123 Fix tab switching" });
  expect(f.completionCalls).toHaveLength(2);
  expect(f.updates).toHaveLength(1);

  host = await host.harness.lifecycle.reload(plugin);
  hosts.splice(hosts.indexOf(f.host), 1, host);
  await host.harness.behavior.emitThreadEvent("experimental_thread.events", { thread: f.thread(), sequence: 20 });
  expect(f.completionCalls).toHaveLength(2);
  expect(await host.bb.storage.kv.get("title-turns:target")).toMatchObject({ successfulTurnIds: ["done"], attemptedTurnIds: ["done"], cursor: 20 });
});

it("cancels a production RPC host call on disposal and never writes its title", async () => {
  const f = fixture(true);
  await f.host.bb.storage.kv.set("title-settings", { titleProvider: "codex", titleModel: "gpt-small" });
  plugin(f.host.bb);
  const request = f.host.harness.behavior.callRpc("refreshTitle", { threadId: "target" }).catch(() => undefined);
  await vi.waitFor(() => expect(f.completionSignal()).toBeInstanceOf(AbortSignal));
  await f.host.harness.lifecycle.dispose();
  hosts.splice(hosts.indexOf(f.host), 1);
  await request;
  expect(f.completionSignal()?.aborted).toBe(true);
  expect(f.updates).toEqual([]);
});
