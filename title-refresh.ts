import type { ResolvedTitleConfiguration } from "./title-configuration";
import type { TitleContextSnapshot } from "./title-context";
import { titleSchema, type TitleRefreshResult } from "./title-contract";
import { createTitleState, type TitleKv } from "./title-state";

export interface CompletionRow {
  seq: number;
  createdAt: number;
  turnId: string;
  status: "completed" | "failed" | "interrupted";
}
export interface TitleRefreshDependencies {
  configuration(): Promise<ResolvedTitleConfiguration>;
  context(threadId: string, signal: AbortSignal): Promise<TitleContextSnapshot>;
  complete(configuration: ResolvedTitleConfiguration, prompt: string, signal: AbortSignal): Promise<{ title: string }>;
  update(threadId: string, title: string, signal: AbortSignal): Promise<unknown>;
  events(threadId: string, afterSeq: number, signal: AbortSignal): Promise<readonly CompletionRow[]>;
  kv: TitleKv;
  signal: AbortSignal;
  activatedAt?: number;
}

function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const cancelled: TitleRefreshResult = { status: "skipped", reason: "Title generation was cancelled." };

export function createTitleRefresh(dependencies: TitleRefreshDependencies) {
  const state = createTitleState(dependencies.kv);
  const activatedAt = dependencies.activatedAt ?? Date.now();
  const tails = new Map<string, Promise<void>>();
  const manual = new Map<string, Promise<TitleRefreshResult>>();
  const slotWaiters: { grant(): void; signal: AbortSignal; onAbort(): void }[] = [];
  let active = 0;

  function acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const release = () => {
        active -= 1;
        const next = slotWaiters.shift();
        if (next) {
          next.signal.removeEventListener("abort", next.onAbort);
          next.grant();
        }
      };
      const grant = () => { active += 1; resolve(release); };
      if (active < 2) { grant(); return; }
      const waiter = { grant, signal, onAbort: () => {
        const index = slotWaiters.indexOf(waiter);
        if (index !== -1) slotWaiters.splice(index, 1);
        reject(signal.reason);
      } };
      slotWaiters.push(waiter);
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal.aborted) waiter.onAbort();
    });
  }

  function enqueue<T>(threadId: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const previous = tails.get(threadId) ?? Promise.resolve();
    const queued = previous.then(() => { signal.throwIfAborted(); return work(); });
    const tail = queued.then(() => {}, () => {});
    tails.set(threadId, tail);
    void tail.then(() => { if (tails.get(threadId) === tail) tails.delete(threadId); });
    return waitFor(queued, signal);
  }

  async function generate(threadId: string, signal: AbortSignal): Promise<TitleRefreshResult> {
    let release: (() => void) | undefined;
    let stage: "configuration" | "context" | "generation" | "update" = "configuration";
    try {
      release = await acquire(signal);
      const configuration = await dependencies.configuration();
      signal.throwIfAborted();
      stage = "context";
      const context = await dependencies.context(threadId, signal);
      signal.throwIfAborted();
      stage = "generation";
      const result = await dependencies.complete(configuration, context.prompt, signal);
      const title = titleSchema.parse(result.title);
      signal.throwIfAborted();
      stage = "context";
      const latestConfiguration = await dependencies.configuration();
      const latestContext = await dependencies.context(threadId, signal);
      signal.throwIfAborted();
      if (latestConfiguration.fingerprint !== configuration.fingerprint || latestContext.fingerprint !== context.fingerprint) {
        return { status: "skipped", reason: "The title, conversation or model settings changed while the title was generated. Try again." };
      }
      if (title === context.title) return { status: "unchanged", title };
      stage = "update";
      await dependencies.update(threadId, title, signal);
      return { status: "updated", title };
    } catch {
      if (signal.aborted) return cancelled;
      const reasons = {
        configuration: "The title provider or model is not configured or is unavailable. Check the plugin settings.",
        context: "The conversation could not be read consistently. Try again.",
        generation: "The selected provider could not generate a valid title. Check its login, model and CLI version.",
        update: "The generated title could not be saved. Try again.",
      };
      return { status: "failed", reason: reasons[stage] };
    } finally { release?.(); }
  }

  return {
    refresh(threadId: string, requestSignal?: AbortSignal): Promise<TitleRefreshResult> {
      const existing = manual.get(threadId);
      if (existing) return existing;
      const signal = requestSignal ? AbortSignal.any([dependencies.signal, requestSignal]) : dependencies.signal;
      const promise = enqueue(threadId, signal, () => generate(threadId, signal)).catch(() => cancelled);
      manual.set(threadId, promise);
      void promise.then(() => { if (manual.get(threadId) === promise) manual.delete(threadId); });
      return promise;
    },
    async onEvents(threadId: string): Promise<void> {
      const signal = dependencies.signal;
      try {
        await enqueue(threadId, signal, async () => {
          const stored = await state.read(threadId);
          while (stored.successfulTurnIds.length < 5) {
            signal.throwIfAborted();
            const rows = await dependencies.events(threadId, stored.cursor, signal);
            if (!rows.length) return;
            let advanced = false;
            for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
              signal.throwIfAborted();
              if (row.seq <= stored.cursor) continue;
              advanced = true;
              stored.cursor = row.seq;
              const isNewSuccess = row.status === "completed" && !stored.successfulTurnIds.includes(row.turnId);
              if (isNewSuccess) stored.successfulTurnIds.push(row.turnId);
              const shouldGenerate = isNewSuccess && row.createdAt >= activatedAt;
              await state.write(threadId, stored);
              if (shouldGenerate) await generate(threadId, signal);
              if (stored.successfulTurnIds.length === 5) return;
            }
            if (!advanced) throw new Error("The title completion event cursor did not advance.");
          }
        });
      } catch {
        // Event observation must not reject into BB's fire-and-forget listener.
      }
    },
  };
}
