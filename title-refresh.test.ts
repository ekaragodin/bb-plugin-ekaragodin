import { expect, it, vi } from "vitest";
import { createTitleRefresh, type CompletionRow, type TitleRefreshDependencies } from "./title-refresh";
import type { ResolvedTitleConfiguration } from "./title-configuration";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const lifetime = new AbortController();
  const stored = new Map<string, unknown>();
  const titles = new Map<string, string>([["thread", "Old title"]]);
  const rows = new Map<string, CompletionRow[]>();
  let revision = "config1";
  let contextRevision = "context1";
  const configuration: ResolvedTitleConfiguration = { providerId: "codex", model: "small-model", hostId: "primary",
    executablePath: "/bin/provider", fingerprint: revision };
  const complete = vi.fn(async (_configuration: ResolvedTitleConfiguration, _prompt: string, _signal: AbortSignal) => ({ title: "New title" }));
  const update = vi.fn(async (threadId: string, title: string) => { titles.set(threadId, title); });
  const dependencies: TitleRefreshDependencies = {
    signal: lifetime.signal, activatedAt: 100,
    configuration: async () => ({ ...configuration, fingerprint: revision }),
    context: async threadId => ({ prompt: "conversation", title: titles.get(threadId) ?? null,
      fingerprint: `${titles.get(threadId)}:${contextRevision}` }),
    complete, update,
    events: async (threadId, afterSeq) => (rows.get(threadId) ?? []).filter(row => row.seq > afterSeq).slice(0, 2),
    kv: { async get<T>(key: string) { return structuredClone(stored.get(key)) as T | undefined; },
      async set(key, value) { stored.set(key, structuredClone(value)); } },
  };
  const service = createTitleRefresh(dependencies);
  const event = (seq: number, status: CompletionRow["status"] = "completed", createdAt = 101, turnId = `turn${seq}`): CompletionRow => ({ seq, status, createdAt, turnId });
  return { service, dependencies, rows, event, complete, update, titles, lifetime, stored,
    changeConfiguration() { revision += "x"; }, changeContext() { contextRevision += "x"; } };
}

it("reconciles batches and duplicate notifications, counting only five unique successful turns", async () => {
  const f = fixture();
  f.rows.set("thread", [f.event(1, "failed"), f.event(2, "interrupted"), f.event(3), f.event(4, "completed", 101, "turn3"),
    f.event(5), f.event(6), f.event(7), f.event(8), f.event(9)]);
  await Promise.all([f.service.onEvents("thread"), f.service.onEvents("thread")]);
  expect(f.complete).toHaveBeenCalledTimes(5);
  await f.service.onEvents("thread");
  expect(f.complete).toHaveBeenCalledTimes(5);
});

it("counts historical turns without backfill and still updates on a future eligible turn", async () => {
  const f = fixture();
  f.rows.set("thread", [f.event(1, "completed", 10), f.event(2, "completed", 50)]);
  await f.service.onEvents("thread");
  expect(f.complete).not.toHaveBeenCalled();
  f.titles.set("thread", "Manually renamed");
  f.rows.get("thread")!.push(f.event(3));
  await f.service.onEvents("thread");
  expect(f.complete).toHaveBeenCalledTimes(1);
  expect(f.titles.get("thread")).toBe("New title");
});

it("does not backfill old threads or consume the automatic budget with a manual request", async () => {
  const f = fixture();
  f.rows.set("thread", Array.from({ length: 10 }, (_, i) => f.event(i + 1, "completed", 10)));
  await f.service.onEvents("thread");
  expect(f.complete).not.toHaveBeenCalled();
  expect(await f.service.refresh("thread")).toEqual({ status: "updated", title: "New title" });
  expect(f.complete).toHaveBeenCalledTimes(1);
});

it("persists the claim before invoking and never automatically retries failures after reload", async () => {
  const f = fixture();
  f.rows.set("thread", [f.event(1)]);
  f.complete.mockImplementationOnce(async () => {
    expect(JSON.stringify([...f.stored.values()])).toContain('"attemptedTurnIds":["turn1"]');
    throw new Error("private provider stderr [SECRET]");
  });
  await f.service.onEvents("thread");
  const reloaded = createTitleRefresh({ ...f.dependencies, activatedAt: 100 });
  await reloaded.onEvents("thread");
  expect(f.complete).toHaveBeenCalledTimes(1);
  expect(f.update).not.toHaveBeenCalled();
  expect(await reloaded.refresh("thread")).toEqual({ status: "updated", title: "New title" });
});

it("marks unavailable-configuration automatic attempts without retroactive calls later", async () => {
  const f = fixture();
  const config = f.dependencies.configuration;
  f.dependencies.configuration = async () => { throw new Error("not configured"); };
  f.rows.set("thread", [f.event(1)]);
  await f.service.onEvents("thread");
  f.dependencies.configuration = config;
  await f.service.onEvents("thread");
  expect(f.complete).not.toHaveBeenCalled();
  await f.service.refresh("thread");
  expect(f.complete).toHaveBeenCalledTimes(1);
});

it("shares duplicate manual clicks and leaves unchanged titles untouched", async () => {
  const f = fixture();
  const response = deferred<{ title: string }>();
  const entered = deferred<void>();
  f.complete.mockImplementation(async () => { entered.resolve(); return response.promise; });
  const a = f.service.refresh("thread");
  const b = f.service.refresh("thread");
  await entered.promise;
  expect(f.complete).toHaveBeenCalledTimes(1);
  response.resolve({ title: "Old title" });
  expect(await a).toEqual({ status: "unchanged", title: "Old title" });
  expect(await b).toEqual({ status: "unchanged", title: "Old title" });
  expect(f.update).not.toHaveBeenCalled();
});

for (const change of ["title", "configuration", "context"] as const) {
  it(`discards an outdated ${change} snapshot without another paid request`, async () => {
    const f = fixture();
    f.complete.mockImplementation(async () => {
      if (change === "title") f.titles.set("thread", "Manual new title");
      else if (change === "configuration") f.changeConfiguration();
      else f.changeContext();
      return { title: "Stale title" };
    });
    expect(await f.service.refresh("thread")).toMatchObject({ status: "skipped" });
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.update).not.toHaveBeenCalled();
  });
}

it("limits generation concurrency across independent threads", async () => {
  const f = fixture();
  const entered = deferred<void>();
  const release = deferred<void>();
  let active = 0;
  let peak = 0;
  f.complete.mockImplementation(async () => {
    active += 1; peak = Math.max(peak, active);
    if (active === 2) entered.resolve();
    await release.promise;
    active -= 1;
    return { title: "New title" };
  });
  const requests = ["a", "b", "c"].map(id => f.service.refresh(id));
  await entered.promise;
  expect(f.complete).toHaveBeenCalledTimes(2);
  release.resolve();
  await Promise.all(requests);
  expect(peak).toBe(2);
  expect(f.complete).toHaveBeenCalledTimes(3);
});

it("returns cancellation promptly for queued requests and stops work on disposal", async () => {
  const f = fixture();
  const entered = deferred<void>();
  f.complete.mockImplementation(async (_config, _prompt, signal) => {
    entered.resolve();
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    return { title: "Never applied" };
  });
  const first = f.service.refresh("thread");
  await entered.promise;
  const waitingAbort = new AbortController();
  const queued = f.service.refresh("other", waitingAbort.signal);
  waitingAbort.abort();
  expect(await queued).toMatchObject({ status: "skipped" });
  f.lifetime.abort();
  expect(await first).toMatchObject({ status: "skipped" });
  await f.service.onEvents("thread");
  expect(f.update).not.toHaveBeenCalled();
});

it("returns only safe failure reasons and preserves the existing title", async () => {
  const f = fixture();
  f.complete.mockRejectedValueOnce(new Error("provider credential [SECRET]"));
  const result = await f.service.refresh("thread");
  expect(result.status).toBe("failed");
  expect(JSON.stringify(result)).not.toContain("SECRET");
  expect(f.titles.get("thread")).toBe("Old title");
  expect(f.update).not.toHaveBeenCalled();
});

it("serializes a manual request behind automatic work without merging the two operations", async () => {
  const f = fixture();
  const entered = deferred<void>();
  const response = deferred<{ title: string }>();
  f.rows.set("thread", [f.event(1)]);
  f.complete.mockImplementationOnce(async () => { entered.resolve(); return response.promise; });
  const automatic = f.service.onEvents("thread");
  await entered.promise;
  const manual = f.service.refresh("thread");
  expect(f.complete).toHaveBeenCalledTimes(1);
  response.resolve({ title: "Automatic title" });
  await automatic;
  expect(await manual).toEqual({ status: "updated", title: "New title" });
  expect(f.complete).toHaveBeenCalledTimes(2);
  expect(f.update.mock.calls.map(call => call[1])).toEqual(["Automatic title", "New title"]);
});

it("leaves all five automatic attempts available after a manual refresh", async () => {
  const f = fixture();
  await f.service.refresh("thread");
  f.rows.set("thread", Array.from({ length: 6 }, (_, i) => f.event(i + 1)));
  await f.service.onEvents("thread");
  expect(f.complete).toHaveBeenCalledTimes(6);
});
