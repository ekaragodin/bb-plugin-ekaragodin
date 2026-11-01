import type { PluginThreadAction } from "@get-bb/plugin-sdk/app";
import type { TitleRefreshResult } from "./title-contract";

type Refresh = (threadId: string) => Promise<TitleRefreshResult>;
interface TitleActionSnapshot {
  busy: ReadonlySet<string>;
  notice: { message: string; error: boolean } | null;
}

export function createTitleActionController() {
  const pending = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let snapshot: TitleActionSnapshot = { busy: new Set(), notice: null };
  const publish = (notice: TitleActionSnapshot["notice"]) => {
    snapshot = { busy: new Set(pending.keys()), notice };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dismiss() { publish(null); },
    action(threadId: string, refresh: Refresh): PluginThreadAction {
      return {
        label: pending.has(threadId) ? "Updating title…" : "Update title",
        icon: "RefreshCw",
        detail: "Choose a title for the thread's current goal",
        disabled: pending.has(threadId),
        run() {
          const existing = pending.get(threadId);
          if (existing) return existing;
          const operation = Promise.resolve().then(async () => {
            let notice: TitleActionSnapshot["notice"];
            try {
              const result = await refresh(threadId);
              const message = result.status === "updated" ? `Thread title updated: ${result.title}`
                : result.status === "unchanged" ? "The current thread title still fits."
                : result.reason ?? "The thread title was not changed.";
              notice = { message, error: result.status === "failed" };
            } catch {
              notice = { message: "Could not refresh the thread title. Try again.", error: true };
            }
            pending.delete(threadId);
            publish(notice);
          });
          pending.set(threadId, operation);
          publish(null);
          return operation;
        },
      };
    },
  };
}
export type TitleActionController = ReturnType<typeof createTitleActionController>;
